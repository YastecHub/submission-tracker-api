import { GpaSemesterStatus, Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import type { CourseInput } from '../domain/semesterInput';
import type { Level, SemesterNumber } from '../domain/grades';

/**
 * Every query is scoped by studentId: GPA records are private to the student who
 * owns them, and there is no class rep or admin access path.
 */
const semesterInclude = {
  courses: { orderBy: [{ sortOrder: 'asc' as const }, { code: 'asc' as const }] },
};

export type GpaSemesterRecord = Prisma.GpaSemesterGetPayload<{ include: typeof semesterInclude }>;

const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 30_000 };

/** Thrown inside the import transaction so every write is rolled back. */
export class GpaImportConflictError extends Error {
  constructor() {
    super('A semester changed while importing');
    this.name = 'GpaImportConflictError';
  }
}

export interface ImportSemesterPlan {
  existingId: string | null;
  expectedVersion: number | null;
  level: Level;
  semester: SemesterNumber;
  sessionLabel: string | null;
  /** Courses to create or replace (matched by code). */
  courses: CourseInput[];
  finalize: boolean;
}

function courseRows(semesterId: string, courses: CourseInput[]): Prisma.GpaCourseCreateManyInput[] {
  return courses.map((course) => ({
    semesterId,
    catalogCourseId: course.catalogCourseId,
    code: course.code,
    title: course.title,
    units: course.units,
    grade: course.grade,
    isCarryover: course.isCarryover,
    isRetake: course.isRetake,
    sortOrder: course.sortOrder,
  }));
}

export class GpaRepository {
  listSemesters(studentId: string) {
    return prisma.gpaSemester.findMany({
      where: { studentId },
      orderBy: [{ level: 'asc' }, { semester: 'asc' }],
      include: semesterInclude,
    });
  }

  findSemester(studentId: string, id: string) {
    return prisma.gpaSemester.findFirst({ where: { id, studentId }, include: semesterInclude });
  }

  /** Used only to tell "someone else's id" apart from "not found" without revealing anything. */
  semesterIdExists(id: string) {
    return prisma.gpaSemester.count({ where: { id } }).then((count) => count > 0);
  }

  findSemesterBySlot(studentId: string, level: number, semester: number) {
    return prisma.gpaSemester.findUnique({
      where: { studentId_level_semester: { studentId, level, semester } },
      include: semesterInclude,
    });
  }

  listCatalog() {
    return prisma.courseCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ level: 'asc' }, { semester: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, title: true, units: true, level: true, semester: true, isElective: true },
    });
  }

  async existingCatalogIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await prisma.courseCatalog.findMany({ where: { id: { in: ids } }, select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  createSemester(studentId: string, data: {
    id: string | null;
    level: Level;
    semester: SemesterNumber;
    sessionLabel: string | null;
    courses: CourseInput[];
  }) {
    return prisma.$transaction(async (tx) => {
      const created = await tx.gpaSemester.create({
        data: {
          ...(data.id ? { id: data.id } : {}),
          studentId,
          level: data.level,
          semester: data.semester,
          sessionLabel: data.sessionLabel,
        },
      });
      if (data.courses.length) await tx.gpaCourse.createMany({ data: courseRows(created.id, data.courses) });
      return tx.gpaSemester.findUniqueOrThrow({ where: { id: created.id }, include: semesterInclude });
    }, TRANSACTION_OPTIONS);
  }

  /** Replaces a draft semester's courses. Returns null if the version or status no longer matches. */
  replaceSemester(studentId: string, id: string, expectedVersion: number, data: { sessionLabel: string | null; courses: CourseInput[] }) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.gpaSemester.updateMany({
        where: { id, studentId, version: expectedVersion, status: GpaSemesterStatus.draft },
        data: { sessionLabel: data.sessionLabel, version: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      await tx.gpaCourse.deleteMany({ where: { semesterId: id } });
      if (data.courses.length) await tx.gpaCourse.createMany({ data: courseRows(id, data.courses) });
      return tx.gpaSemester.findUniqueOrThrow({ where: { id }, include: semesterInclude });
    }, TRANSACTION_OPTIONS);
  }

  async setStatus(studentId: string, id: string, expectedVersion: number, from: GpaSemesterStatus, to: GpaSemesterStatus) {
    const updated = await prisma.gpaSemester.updateMany({
      where: { id, studentId, version: expectedVersion, status: from },
      data: { status: to, finalizedAt: to === GpaSemesterStatus.finalized ? new Date() : null, version: { increment: 1 } },
    });
    if (updated.count !== 1) return null;
    return this.findSemester(studentId, id);
  }

  async deleteSemester(studentId: string, id: string) {
    const deleted = await prisma.gpaSemester.deleteMany({ where: { id, studentId } });
    return deleted.count === 1;
  }

  /**
   * Applies a whole CSV import in one transaction: either every semester is
   * written or nothing is. Uses a few set-based queries per semester, so a
   * 100+ row import stays well inside the transaction timeout.
   */
  applyImport(studentId: string, plan: ImportSemesterPlan[]) {
    return prisma.$transaction(async (tx) => {
      for (const item of plan) {
        let semesterId: string;
        if (item.existingId) {
          const updated = await tx.gpaSemester.updateMany({
            where: { id: item.existingId, studentId, version: item.expectedVersion!, status: GpaSemesterStatus.draft },
            data: { version: { increment: 1 }, ...(item.sessionLabel ? { sessionLabel: item.sessionLabel } : {}) },
          });
          if (updated.count !== 1) throw new GpaImportConflictError();
          semesterId = item.existingId;
          await tx.gpaCourse.deleteMany({ where: { semesterId, code: { in: item.courses.map((course) => course.code) } } });
        } else {
          const created = await tx.gpaSemester.create({
            data: { studentId, level: item.level, semester: item.semester, sessionLabel: item.sessionLabel },
          });
          semesterId = created.id;
        }
        await tx.gpaCourse.createMany({ data: courseRows(semesterId, item.courses) });
        if (item.finalize) {
          await tx.gpaSemester.update({
            where: { id: semesterId },
            data: { status: GpaSemesterStatus.finalized, finalizedAt: new Date(), version: { increment: 1 } },
          });
        }
      }
      return tx.gpaSemester.findMany({
        where: { studentId },
        orderBy: [{ level: 'asc' }, { semester: 'asc' }],
        include: semesterInclude,
      });
    }, TRANSACTION_OPTIONS);
  }
}

export const gpaRepository = new GpaRepository();
