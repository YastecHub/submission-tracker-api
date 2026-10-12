import { parseCsv } from './csv';
import { isGrade, isLevel, normalizeCourseCode, type Grade, type Level, type SemesterNumber } from './grades';

export const IMPORT_TEMPLATE_HEADER = 'level,semester,code,title,units,grade,carryover,retake,session';
export const MAX_IMPORT_ROWS = 1_000;
export const MAX_IMPORT_CHARACTERS = 500_000;

export interface ImportRow {
  line: number;
  level: Level;
  semester: SemesterNumber;
  code: string;
  title: string | null;
  units: number | null;
  grade: Grade | null;
  isCarryover: boolean;
  isRetake: boolean;
  sessionLabel: string | null;
}

export interface ImportIssue {
  line: number;
  column?: string;
  message: string;
}

type Column = 'level' | 'semester' | 'code' | 'title' | 'units' | 'grade' | 'carryover' | 'retake' | 'session';

const HEADER_ALIASES: Record<string, Column> = {
  level: 'level', lvl: 'level', year: 'level',
  semester: 'semester', sem: 'semester',
  code: 'code', coursecode: 'code', course: 'code',
  title: 'title', coursetitle: 'title', name: 'title', coursename: 'title',
  units: 'units', unit: 'units', creditunits: 'units', creditunit: 'units', cu: 'units', credits: 'units', credit: 'units',
  grade: 'grade',
  carryover: 'carryover', co: 'carryover',
  retake: 'retake', resit: 'retake',
  session: 'session', academicsession: 'session',
};

const REQUIRED: Column[] = ['level', 'semester', 'code'];

export function parseLevel(value: string): Level | null {
  const match = value.trim().toLowerCase().match(/^(\d{3})\s*(l|level)?$/);
  const level = match ? Number(match[1]) : NaN;
  return isLevel(level) ? level : null;
}

export function parseSemester(value: string): SemesterNumber | null {
  const normalized = value.trim().toLowerCase().replace(/\s*semester$/, '');
  if (['1', '1st', 'first', 'harmattan'].includes(normalized)) return 1;
  if (['2', '2nd', 'second', 'rain'].includes(normalized)) return 2;
  return null;
}

export function parseFlag(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['', 'no', 'n', 'false', '0'].includes(normalized)) return false;
  if (['yes', 'y', 'true', '1', 'x'].includes(normalized)) return true;
  return null;
}

export function parseSessionLabel(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})\s*[/-]\s*(\d{4})$/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return undefined;
  return `${match[1]}/${match[2]}`;
}

/**
 * Reads and validates a GPA import CSV. Returns every problem found (not just the
 * first), so students can fix their file in one go. Title and units may be blank
 * when the course is in the catalog; the service fills them in.
 */
export function parseImportCsv(text: string): { rows: ImportRow[]; issues: ImportIssue[] } {
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  if (text.length > MAX_IMPORT_CHARACTERS) {
    return { rows, issues: [{ line: 0, message: 'The file is too large. Split it into smaller files.' }] };
  }

  let columns: Array<Column | null> | null = null;
  const seen = new Map<string, number>();

  for (const record of parseCsv(text)) {
    if (!columns) {
      columns = record.values.map((header) => HEADER_ALIASES[header.toLowerCase().replace(/[^a-z]/g, '')] ?? null);
      const missing = REQUIRED.filter((column) => !columns!.includes(column));
      if (missing.length) {
        return { rows, issues: [{ line: record.line, message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Use the template header: ${IMPORT_TEMPLATE_HEADER}` }] };
      }
      continue;
    }

    if (rows.length + issues.length >= MAX_IMPORT_ROWS) {
      issues.push({ line: record.line, message: `Only ${MAX_IMPORT_ROWS} rows can be imported at once.` });
      break;
    }

    const cell = (column: Column) => {
      const position = columns!.indexOf(column);
      return position === -1 ? '' : record.values[position] ?? '';
    };
    const rowIssues: ImportIssue[] = [];
    const fail = (column: Column, message: string) => rowIssues.push({ line: record.line, column, message });

    const level = parseLevel(cell('level'));
    if (!level) fail('level', `"${cell('level')}" is not a level. Use 100, 200, 300, 400, 500 or 600.`);
    const semester = parseSemester(cell('semester'));
    if (!semester) fail('semester', `"${cell('semester')}" is not a semester. Use 1 or 2.`);

    const rawCode = cell('code');
    const code = normalizeCourseCode(rawCode);
    if (!code) fail('code', 'Course code is required.');
    else if (code.length > 20) fail('code', 'Course code is too long.');

    const title = cell('title') || null;
    if (title && title.length > 150) fail('title', 'Course title is too long (150 characters max).');

    const rawUnits = cell('units');
    let units: number | null = null;
    if (rawUnits) {
      units = Number(rawUnits);
      if (!Number.isInteger(units) || units < 1 || units > 12) {
        fail('units', `"${rawUnits}" is not a valid number of units (1 to 12).`);
        units = null;
      }
    }

    const rawGrade = cell('grade').toUpperCase();
    const grade = rawGrade === '' || rawGrade === '-' ? null : rawGrade;
    if (grade !== null && !isGrade(grade)) fail('grade', `"${cell('grade')}" is not a grade. Use A, B, C, D, E or F, or leave it blank if the result is not out yet.`);

    const isCarryover = parseFlag(cell('carryover'));
    if (isCarryover === null) fail('carryover', `"${cell('carryover')}" should be yes or no.`);
    const isRetake = parseFlag(cell('retake'));
    if (isRetake === null) fail('retake', `"${cell('retake')}" should be yes or no.`);

    const sessionLabel = parseSessionLabel(cell('session'));
    if (sessionLabel === undefined) fail('session', `"${cell('session')}" is not a session. Use the format 2025/2026.`);

    if (level && semester && code) {
      const key = `${level}-${semester}-${code.replace(/\s/g, '')}`;
      const firstLine = seen.get(key);
      if (firstLine) fail('code', `${code} is listed twice for ${level}L semester ${semester} (also on line ${firstLine}).`);
      else seen.set(key, record.line);
    }

    if (rowIssues.length) {
      issues.push(...rowIssues);
      continue;
    }
    rows.push({
      line: record.line,
      level: level!,
      semester: semester!,
      code,
      title,
      units,
      grade: grade as Grade | null,
      isCarryover: isCarryover!,
      isRetake: isRetake!,
      sessionLabel: sessionLabel ?? null,
    });
  }

  if (!columns) issues.push({ line: 0, message: 'The file is empty.' });
  else if (rows.length === 0 && issues.length === 0) issues.push({ line: 0, message: 'The file has a header but no courses.' });
  return { rows, issues };
}
