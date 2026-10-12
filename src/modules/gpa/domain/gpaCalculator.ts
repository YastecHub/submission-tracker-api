import { degreeClass, GRADE_POINTS, type Grade } from './grades';

export interface CourseForGpa {
  units: number;
  grade: Grade | null;
}

export interface SemesterForGpa {
  level: number;
  semester: number;
  status: 'draft' | 'finalized';
  courses: CourseForGpa[];
}

export interface GpaTotals {
  /** Units of graded courses (the GPA denominator). */
  units: number;
  /** Sum of grade points x units. */
  points: number;
  gpa: number | null;
  gradedCourses: number;
  pendingCourses: number;
  /** Units of courses still waiting for a grade. */
  pendingUnits: number;
}

/** Rounds to 2 decimal places, half up, using integer maths to avoid float drift. */
export function roundGpa(points: number, units: number): number | null {
  if (units <= 0) return null;
  return Math.round((points * 100) / units) / 100;
}

export function courseTotals(courses: CourseForGpa[]): GpaTotals {
  let units = 0;
  let points = 0;
  let gradedCourses = 0;
  let pendingCourses = 0;
  let pendingUnits = 0;
  for (const course of courses) {
    if (course.grade === null) {
      pendingCourses += 1;
      pendingUnits += course.units;
      continue;
    }
    units += course.units;
    points += GRADE_POINTS[course.grade] * course.units;
    gradedCourses += 1;
  }
  return { units, points, gpa: roundGpa(points, units), gradedCourses, pendingCourses, pendingUnits };
}

export interface GpaSummary {
  /** CGPA from finalized semesters only: the "official" number. */
  cgpa: number | null;
  units: number;
  points: number;
  degreeClass: string | null;
  /** Includes graded courses in draft semesters too. */
  projectedCgpa: number | null;
  projectedUnits: number;
  finalizedSemesters: number;
  draftSemesters: number;
  pendingCourses: number;
}

/**
 * Carryovers and retakes count like any other course: both attempts are in the CGPA.
 */
export function summarize(semesters: SemesterForGpa[]): GpaSummary {
  let units = 0;
  let points = 0;
  let projectedUnits = 0;
  let projectedPoints = 0;
  let finalizedSemesters = 0;
  let draftSemesters = 0;
  let pendingCourses = 0;
  for (const semester of semesters) {
    const totals = courseTotals(semester.courses);
    projectedUnits += totals.units;
    projectedPoints += totals.points;
    pendingCourses += totals.pendingCourses;
    if (semester.status === 'finalized') {
      finalizedSemesters += 1;
      units += totals.units;
      points += totals.points;
    } else {
      draftSemesters += 1;
    }
  }
  const cgpa = roundGpa(points, units);
  return {
    cgpa,
    units,
    points,
    degreeClass: degreeClass(cgpa),
    projectedCgpa: roundGpa(projectedPoints, projectedUnits),
    projectedUnits,
    finalizedSemesters,
    draftSemesters,
    pendingCourses,
  };
}
