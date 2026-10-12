import { badRequest } from '../../../shared/errors/AppError';
import { parseSessionLabel } from './gpaImport';
import {
  isGrade,
  isLevel,
  isSemesterNumber,
  MAX_COURSES_PER_SEMESTER,
  MAX_UNITS_PER_COURSE,
  normalizeCourseCode,
  type Grade,
  type Level,
  type SemesterNumber,
} from './grades';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CourseInput {
  catalogCourseId: string | null;
  code: string;
  title: string;
  units: number;
  grade: Grade | null;
  isCarryover: boolean;
  isRetake: boolean;
  sortOrder: number;
}

export interface SemesterContentInput {
  sessionLabel: string | null;
  courses: CourseInput[];
}

export interface NewSemesterInput extends SemesterContentInput {
  id: string | null;
  level: Level;
  semester: SemesterNumber;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(message);
  return value as Record<string, unknown>;
}

export function courseKey(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

function courseInput(value: unknown, position: number): CourseInput {
  const input = record(value, `Course ${position} is invalid`);
  const code = typeof input.code === 'string' ? normalizeCourseCode(input.code) : '';
  if (!code) throw badRequest(`Course ${position} needs a course code`);
  if (code.length > 20) throw badRequest(`${code} is too long for a course code`);

  const title = typeof input.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
  if (title.length > 150) throw badRequest(`The title for ${code} is too long`);

  const units = typeof input.units === 'number' ? input.units : Number(input.units);
  if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS_PER_COURSE) {
    throw badRequest(`${code} needs between 1 and ${MAX_UNITS_PER_COURSE} units`);
  }

  const grade = input.grade === null || input.grade === undefined || input.grade === '' ? null : input.grade;
  if (grade !== null && !isGrade(grade)) throw badRequest(`${code} has an invalid grade. Use A, B, C, D, E or F`);

  const catalogCourseId = typeof input.catalogCourseId === 'string' && UUID_PATTERN.test(input.catalogCourseId)
    ? input.catalogCourseId
    : null;

  return {
    catalogCourseId,
    code,
    title: title || code,
    units,
    grade,
    isCarryover: input.isCarryover === true,
    isRetake: input.isRetake === true,
    sortOrder: position - 1,
  };
}

export function semesterContentInput(value: unknown): SemesterContentInput {
  const input = record(value, 'Semester details are invalid');
  const rawSession = typeof input.sessionLabel === 'string' ? input.sessionLabel : '';
  const sessionLabel = parseSessionLabel(rawSession);
  if (sessionLabel === undefined) throw badRequest('Session should look like 2025/2026');

  if (!Array.isArray(input.courses)) throw badRequest('Courses are required');
  if (input.courses.length > MAX_COURSES_PER_SEMESTER) {
    throw badRequest(`A semester can have at most ${MAX_COURSES_PER_SEMESTER} courses`);
  }
  const courses = input.courses.map((course, index) => courseInput(course, index + 1));
  const seen = new Set<string>();
  for (const course of courses) {
    const key = courseKey(course.code);
    if (seen.has(key)) throw badRequest(`${course.code} is listed twice in this semester`);
    seen.add(key);
  }
  return { sessionLabel, courses };
}

export function newSemesterInput(value: unknown): NewSemesterInput {
  const input = record(value, 'Semester details are invalid');
  const level = typeof input.level === 'number' ? input.level : Number(input.level);
  if (!isLevel(level)) throw badRequest('Level must be 100, 200, 300, 400 or 500');
  const semester = typeof input.semester === 'number' ? input.semester : Number(input.semester);
  if (!isSemesterNumber(semester)) throw badRequest('Semester must be 1 or 2');
  if (input.id !== undefined && input.id !== null && (typeof input.id !== 'string' || !UUID_PATTERN.test(input.id))) {
    throw badRequest('Semester id is invalid');
  }
  return {
    id: typeof input.id === 'string' ? input.id.toLowerCase() : null,
    level,
    semester,
    ...semesterContentInput({ sessionLabel: input.sessionLabel, courses: input.courses ?? [] }),
  };
}

export function expectedVersion(value: unknown): number {
  const version = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(version) || version < 1) throw badRequest('Semester version is invalid');
  return version;
}
