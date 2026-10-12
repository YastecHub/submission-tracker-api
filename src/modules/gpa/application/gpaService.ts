import { GpaSemesterStatus, Prisma } from '@prisma/client';
import { AppError, badRequest, notFound } from '../../../shared/errors/AppError';
import { cacheGet, cacheSet } from '../../../utils/cache';
import { courseTotals, summarize, type GpaSummary, type GpaTotals } from '../domain/gpaCalculator';
import { parseImportCsv, type ImportIssue } from '../domain/gpaImport';
import { MAX_COURSES_PER_SEMESTER, type Grade } from '../domain/grades';
import {
  courseKey,
  expectedVersion,
  newSemesterInput,
  semesterContentInput,
  UUID_PATTERN,
  type CourseInput,
} from '../domain/semesterInput';
import {
  GpaImportConflictError,
  gpaRepository,
  type GpaRepository,
  type GpaSemesterRecord,
  type ImportSemesterPlan,
} from '../infrastructure/gpaRepository';

const CATALOG_CACHE_KEY = 'gpa:catalog';
const CATALOG_CACHE_MS = 5 * 60_000;

export interface GpaCourseDto {
  id: string;
  catalogCourseId: string | null;
  code: string;
  title: string;
  units: number;
  grade: Grade | null;
  isCarryover: boolean;
  isRetake: boolean;
  sortOrder: number;
}

export interface GpaSemesterDto {
  id: string;
  level: number;
  semester: number;
  sessionLabel: string | null;
  status: 'draft' | 'finalized';
  finalizedAt: Date | null;
  version: number;
  updatedAt: Date;
  courses: GpaCourseDto[];
  totals: GpaTotals;
}

export interface GpaRecordDto {
  semesters: GpaSemesterDto[];
  summary: GpaSummary;
}

export interface CatalogCourseDto {
  id: string;
  code: string;
  title: string;
  units: number;
  level: number;
  semester: number;
  isElective: boolean;
}

function semesterName(level: number, semester: number): string {
  return `${level}L ${semester === 1 ? 'first' : 'second'} semester`;
}

function toDto(record: GpaSemesterRecord): GpaSemesterDto {
  const courses = record.courses.map((course) => ({
    id: course.id,
    catalogCourseId: course.catalogCourseId,
    code: course.code,
    title: course.title,
    units: course.units,
    grade: course.grade as Grade | null,
    isCarryover: course.isCarryover,
    isRetake: course.isRetake,
    sortOrder: course.sortOrder,
  }));
  return {
    id: record.id,
    level: record.level,
    semester: record.semester,
    sessionLabel: record.sessionLabel,
    status: record.status,
    finalizedAt: record.finalizedAt,
    version: record.version,
    updatedAt: record.updatedAt,
    courses,
    totals: courseTotals(courses),
  };
}

function toRecord(records: GpaSemesterRecord[]): GpaRecordDto {
  const semesters = records.map(toDto);
  return { semesters, summary: summarize(semesters) };
}

function semesterId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw notFound('Semester not found');
  return value.toLowerCase();
}

function conflict(message: string): AppError {
  return new AppError(409, message);
}

const CHANGED_ELSEWHERE = 'This semester was changed on another device. Reload to see the latest version.';

export class GpaService {
  constructor(private readonly repository: GpaRepository) {}

  async getRecord(studentId: string): Promise<GpaRecordDto> {
    return toRecord(await this.repository.listSemesters(studentId));
  }

  async catalog(): Promise<{ courses: CatalogCourseDto[] }> {
    const cached = cacheGet<CatalogCourseDto[]>(CATALOG_CACHE_KEY);
    if (cached) return { courses: cached };
    const courses = await this.repository.listCatalog();
    cacheSet(CATALOG_CACHE_KEY, courses, CATALOG_CACHE_MS);
    return { courses };
  }

  async createSemester(studentId: string, body: unknown): Promise<GpaSemesterDto> {
    const input = newSemesterInput(body);

    // Safe retries: offline drafts are created with a client id, so a repeated
    // request after a lost response returns the semester that was already saved.
    if (input.id) {
      const existing = await this.repository.findSemester(studentId, input.id);
      if (existing) return toDto(existing);
    }

    const slotTaken = `You already have ${semesterName(input.level, input.semester)}. Open it to add or change courses.`;
    if (await this.repository.findSemesterBySlot(studentId, input.level, input.semester)) throw conflict(slotTaken);

    try {
      return toDto(await this.repository.createSemester(studentId, {
        ...input,
        courses: await this.withKnownCatalogIds(input.courses),
      }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (input.id && !(await this.repository.findSemester(studentId, input.id)) && (await this.repository.semesterIdExists(input.id))) {
          throw conflict('This semester could not be saved. Please try again.');
        }
        throw conflict(slotTaken);
      }
      throw error;
    }
  }

  async updateSemester(studentId: string, rawId: string, body: unknown): Promise<GpaSemesterDto> {
    const id = semesterId(rawId);
    const content = semesterContentInput(body);
    const version = expectedVersion((body as { expectedVersion?: unknown } | null)?.expectedVersion);

    const current = await this.repository.findSemester(studentId, id);
    if (!current) throw notFound('Semester not found');
    if (current.status === GpaSemesterStatus.finalized) {
      throw conflict('This semester is finalized. Unlock it to make changes.');
    }

    const updated = await this.repository.replaceSemester(studentId, id, version, {
      sessionLabel: content.sessionLabel,
      courses: await this.withKnownCatalogIds(content.courses),
    });
    if (!updated) throw conflict(CHANGED_ELSEWHERE);
    return toDto(updated);
  }

  async finalizeSemester(studentId: string, rawId: string, body: unknown): Promise<GpaSemesterDto> {
    const id = semesterId(rawId);
    const version = expectedVersion((body as { expectedVersion?: unknown } | null)?.expectedVersion);
    const current = await this.repository.findSemester(studentId, id);
    if (!current) throw notFound('Semester not found');
    if (current.status === GpaSemesterStatus.finalized) return toDto(current);
    if (current.courses.length === 0) throw badRequest('Add your courses before finalizing this semester');
    const pending = current.courses.filter((course) => course.grade === null).map((course) => course.code);
    if (pending.length) {
      throw badRequest(`Add a grade for ${pending.slice(0, 3).join(', ')}${pending.length > 3 ? ` and ${pending.length - 3} more` : ''} before finalizing`);
    }
    const updated = await this.repository.setStatus(studentId, id, version, GpaSemesterStatus.draft, GpaSemesterStatus.finalized);
    if (!updated) throw conflict(CHANGED_ELSEWHERE);
    return toDto(updated);
  }

  async unlockSemester(studentId: string, rawId: string, body: unknown): Promise<GpaSemesterDto> {
    const id = semesterId(rawId);
    const version = expectedVersion((body as { expectedVersion?: unknown } | null)?.expectedVersion);
    const current = await this.repository.findSemester(studentId, id);
    if (!current) throw notFound('Semester not found');
    if (current.status === GpaSemesterStatus.draft) return toDto(current);
    const updated = await this.repository.setStatus(studentId, id, version, GpaSemesterStatus.finalized, GpaSemesterStatus.draft);
    if (!updated) throw conflict(CHANGED_ELSEWHERE);
    return toDto(updated);
  }

  async deleteSemester(studentId: string, rawId: string): Promise<{ deleted: true }> {
    const id = semesterId(rawId);
    if (!(await this.repository.deleteSemester(studentId, id))) throw notFound('Semester not found');
    return { deleted: true };
  }

  /**
   * CSV import. A dry run returns a preview; a real run writes everything in one
   * transaction. Any invalid row rejects the whole import with line-by-line errors.
   */
  async importCsv(studentId: string, body: unknown) {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (typeof input.csv !== 'string' || !input.csv.trim()) throw badRequest('Choose or paste a CSV file to import');
    const dryRun = input.dryRun !== false;
    const finalizeImported = input.finalize !== false;

    const { rows, issues } = parseImportCsv(input.csv);
    const [{ courses: catalog }, existing] = await Promise.all([this.catalog(), this.repository.listSemesters(studentId)]);
    const catalogByCode = new Map(catalog.map((course) => [courseKey(course.code), course]));

    // Fill blank titles/units from the course list.
    const resolved: Array<CourseInput & { level: number; semester: number; line: number; sessionLabel: string | null }> = [];
    for (const row of rows) {
      const fromCatalog = catalogByCode.get(courseKey(row.code));
      const units = row.units ?? fromCatalog?.units ?? null;
      if (units === null) {
        issues.push({ line: row.line, column: 'units', message: `${row.code} is not in the course list, so its units are needed.` });
        continue;
      }
      resolved.push({
        line: row.line,
        level: row.level,
        semester: row.semester,
        sessionLabel: row.sessionLabel,
        catalogCourseId: fromCatalog?.id ?? null,
        code: fromCatalog && courseKey(fromCatalog.code) === courseKey(row.code) ? fromCatalog.code : row.code,
        title: row.title ?? fromCatalog?.title ?? row.code,
        units,
        grade: row.grade,
        isCarryover: row.isCarryover,
        isRetake: row.isRetake,
        sortOrder: 0,
      });
    }

    const groups = new Map<string, typeof resolved>();
    for (const row of resolved) {
      const key = `${row.level}-${row.semester}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const plan: ImportSemesterPlan[] = [];
    const preview: Array<{
      level: number; semester: number; isNew: boolean; added: number; updated: number;
      totalCourses: number; gpa: number | null; willFinalize: boolean; pendingCourses: number;
    }> = [];
    const mergedSemesters = new Map(existing.map((semester) => [`${semester.level}-${semester.semester}`, {
      level: semester.level,
      semester: semester.semester,
      status: semester.status as 'draft' | 'finalized',
      courses: semester.courses.map((course) => ({ units: course.units, grade: course.grade as Grade | null })),
    }]));

    for (const [key, groupRows] of [...groups.entries()].sort()) {
      const { level, semester, line } = groupRows[0];
      const current = existing.find((item) => `${item.level}-${item.semester}` === key) ?? null;
      if (current?.status === GpaSemesterStatus.finalized) {
        issues.push({ line, message: `Your ${semesterName(level, semester)} is finalized. Unlock it in the app before importing into it.` });
        continue;
      }
      const existingByKey = new Map((current?.courses ?? []).map((course) => [courseKey(course.code), course]));
      let nextOrder = Math.max(-1, ...(current?.courses ?? []).map((course) => course.sortOrder)) + 1;
      const courses: CourseInput[] = groupRows.map(({ level: _l, semester: _s, line: _line, sessionLabel: _session, ...course }) => {
        const replacing = existingByKey.get(courseKey(course.code));
        return { ...course, sortOrder: replacing ? replacing.sortOrder : nextOrder++ };
      });
      const incomingKeys = new Set(courses.map((course) => courseKey(course.code)));
      const merged = [
        ...(current?.courses ?? []).filter((course) => !incomingKeys.has(courseKey(course.code)))
          .map((course) => ({ units: course.units, grade: course.grade as Grade | null })),
        ...courses.map((course) => ({ units: course.units, grade: course.grade })),
      ];
      if (merged.length > MAX_COURSES_PER_SEMESTER) {
        issues.push({ line, message: `${semesterName(level, semester)} would have ${merged.length} courses (${MAX_COURSES_PER_SEMESTER} max).` });
        continue;
      }
      const totals = courseTotals(merged);
      const willFinalize = finalizeImported && totals.pendingCourses === 0;
      const updatedCount = courses.filter((course) => existingByKey.has(courseKey(course.code))).length;
      preview.push({
        level, semester, isNew: !current, added: courses.length - updatedCount, updated: updatedCount,
        totalCourses: merged.length, gpa: totals.gpa, willFinalize, pendingCourses: totals.pendingCourses,
      });
      mergedSemesters.set(key, { level, semester, status: willFinalize ? 'finalized' : 'draft', courses: merged });
      plan.push({
        existingId: current?.id ?? null,
        expectedVersion: current?.version ?? null,
        level: level as ImportSemesterPlan['level'],
        semester: semester as ImportSemesterPlan['semester'],
        sessionLabel: groupRows.find((row) => row.sessionLabel)?.sessionLabel ?? null,
        courses,
        finalize: willFinalize,
      });
    }

    const sortedIssues: ImportIssue[] = issues.sort((a, b) => a.line - b.line);
    const result = {
      valid: sortedIssues.length === 0,
      rowCount: rows.length,
      issues: sortedIssues,
      semesters: preview,
      summaryAfterImport: summarize([...mergedSemesters.values()]),
    };
    if (!result.valid || dryRun) return { ...result, imported: false };

    try {
      const records = await this.repository.applyImport(studentId, plan);
      return { ...result, imported: true, record: toRecord(records) };
    } catch (error) {
      if (error instanceof GpaImportConflictError
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw conflict('Your GPA record changed while importing. Nothing was imported - check the preview and try again.');
      }
      throw error;
    }
  }

  /** Drops links to catalog courses that no longer exist (the copied code/title/units are kept). */
  private async withKnownCatalogIds(courses: CourseInput[]): Promise<CourseInput[]> {
    const ids = [...new Set(courses.map((course) => course.catalogCourseId).filter((id): id is string => !!id))];
    const known = await this.repository.existingCatalogIds(ids);
    return courses.map((course) => (
      course.catalogCourseId && !known.has(course.catalogCourseId) ? { ...course, catalogCourseId: null } : course
    ));
  }
}

export const gpaService = new GpaService(gpaRepository);
