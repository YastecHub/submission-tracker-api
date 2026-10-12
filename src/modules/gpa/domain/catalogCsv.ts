import { parseCsv } from './csv';
import { MAX_UNITS_PER_COURSE, normalizeCourseCode } from './grades';
import { parseFlag, parseLevel, parseSemester } from './gpaImport';

/** One row of prisma/data/course-catalog.csv. */
export interface CatalogRow {
  code: string;
  title: string;
  units: number;
  level: number;
  semester: number;
  isElective: boolean;
  sortOrder: number;
}

export interface StoredCatalogCourse extends CatalogRow {
  id: string;
  isActive: boolean;
}

/** Reads and validates the developer-maintained course list. Returns every problem found. */
export function readCatalogCsv(text: string): { rows: CatalogRow[]; errors: string[] } {
  const rows: CatalogRow[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  let header: string[] | null = null;
  let position = 0;

  for (const record of parseCsv(text)) {
    if (!header) {
      header = record.values.map((value) => value.toLowerCase());
      for (const column of ['code', 'title', 'units', 'level', 'semester']) {
        if (!header.includes(column)) errors.push(`Header is missing "${column}"`);
      }
      if (errors.length) break;
      continue;
    }
    const cell = (column: string) => record.values[header!.indexOf(column)] ?? '';
    const where = `line ${record.line}`;
    const code = normalizeCourseCode(cell('code'));
    const title = cell('title').replace(/\s+/g, ' ');
    const units = Number(cell('units'));
    const level = parseLevel(cell('level'));
    const semester = parseSemester(cell('semester'));
    const isElective = header.includes('elective') ? parseFlag(cell('elective')) : false;
    const sortText = header.includes('sort') ? cell('sort') : '';
    const sortOrder = sortText ? Number(sortText) : position;

    if (!code) errors.push(`${where}: code is required`);
    if (!title) errors.push(`${where}: title is required`);
    if (title.length > 150) errors.push(`${where}: title is too long`);
    if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS_PER_COURSE) errors.push(`${where}: units must be 1-${MAX_UNITS_PER_COURSE}`);
    if (!level) errors.push(`${where}: level must be 100-600`);
    if (!semester) errors.push(`${where}: semester must be 1 or 2`);
    if (isElective === null) errors.push(`${where}: elective must be yes or no`);
    if (!Number.isInteger(sortOrder)) errors.push(`${where}: sort must be a whole number`);
    const key = code.replace(/\s/g, '');
    if (seen.has(key)) errors.push(`${where}: ${code} is already on line ${seen.get(key)}`);
    seen.set(key, record.line);

    rows.push({ code, title, units, level: level ?? 0, semester: semester ?? 0, isElective: !!isElective, sortOrder });
    position += 1;
  }
  if (!header) errors.push('The file has no header row');
  return { rows, errors };
}

/** What has to change in the database so it matches the file. */
export function planCatalogSync(existing: StoredCatalogCourse[], rows: CatalogRow[], deactivateMissing = false) {
  const byCode = new Map(existing.map((course) => [course.code, course]));
  const toCreate = rows.filter((row) => !byCode.has(row.code));
  const toUpdate = rows.filter((row) => {
    const current = byCode.get(row.code);
    return !!current && (current.title !== row.title || current.units !== row.units || current.level !== row.level
      || current.semester !== row.semester || current.isElective !== row.isElective || current.sortOrder !== row.sortOrder || !current.isActive);
  });
  const fileCodes = new Set(rows.map((row) => row.code));
  const toDeactivate = deactivateMissing ? existing.filter((course) => course.isActive && !fileCodes.has(course.code)) : [];
  return { toCreate, toUpdate, toDeactivate, unchanged: rows.length - toCreate.length - toUpdate.length };
}
