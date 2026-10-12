/**
 * UNILAG 5.0 grading scale. Hard-coded on purpose: the department uses one scale.
 * The client mirrors this file in client/src/features/gpa/model/gpa.ts.
 */
export const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Grade = (typeof GRADES)[number];

export const GRADE_POINTS: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };

/** Pharm. D. is a six-year programme: 100L to 600L. */
export const LEVELS = [100, 200, 300, 400, 500, 600] as const;
export type Level = (typeof LEVELS)[number];
export const SEMESTERS = [1, 2] as const;
export type SemesterNumber = (typeof SEMESTERS)[number];

/** The heaviest course in the programme carries 6 units. */
export const MAX_UNITS_PER_COURSE = 6;
export const MAX_COURSES_PER_SEMESTER = 30;

/** Standard NUC degree classes on a 5.0 scale. */
export const DEGREE_CLASSES = [
  { min: 4.5, label: 'First Class' },
  { min: 3.5, label: 'Second Class Upper' },
  { min: 2.4, label: 'Second Class Lower' },
  { min: 1.5, label: 'Third Class' },
  { min: 1.0, label: 'Pass' },
] as const;

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === 'number' && (LEVELS as readonly number[]).includes(value);
}

export function isSemesterNumber(value: unknown): value is SemesterNumber {
  return value === 1 || value === 2;
}

/**
 * Normalises course codes so "pct201", "PCT 201" and "PCT  201" are the same course.
 * Codes that don't look like LETTERS + DIGITS are kept as typed (uppercased, single spaces).
 */
export function normalizeCourseCode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = compact.replace(/\s+/g, '').match(/^([A-Z]{2,5}(?:-[A-Z]{1,5})?)(\d{3,4}[A-Z]?)$/);
  return match ? `${match[1]} ${match[2]}` : compact;
}

export function degreeClass(cgpa: number | null): string | null {
  if (cgpa === null) return null;
  return DEGREE_CLASSES.find((band) => cgpa >= band.min)?.label ?? 'Below Pass';
}
