import assert from 'node:assert/strict';
import test from 'node:test';
import { courseTotals, roundGpa, summarize } from '../src/modules/gpa/domain/gpaCalculator';
import { degreeClass, normalizeCourseCode } from '../src/modules/gpa/domain/grades';

test('semester GPA is grade points x units over graded units (5.0 scale)', () => {
  // A(5)x3 + B(4)x2 + C(3)x3 + F(0)x1 = 15 + 8 + 9 + 0 = 32 over 9 units = 3.555...
  const totals = courseTotals([
    { units: 3, grade: 'A' }, { units: 2, grade: 'B' }, { units: 3, grade: 'C' }, { units: 1, grade: 'F' },
  ]);
  assert.equal(totals.points, 32);
  assert.equal(totals.units, 9);
  assert.equal(totals.gpa, 3.56);
});

test('courses without a grade yet are pending and do not affect the GPA', () => {
  const totals = courseTotals([{ units: 3, grade: 'A' }, { units: 4, grade: null }]);
  assert.equal(totals.gpa, 5);
  assert.equal(totals.pendingCourses, 1);
  assert.equal(totals.pendingUnits, 4);
  assert.equal(courseTotals([]).gpa, null);
});

test('rounding is half-up to 2 decimals without float drift', () => {
  assert.equal(roundGpa(4005, 1000), 4.01);
  assert.equal(roundGpa(2, 3), 0.67);
  assert.equal(roundGpa(0, 0), null);
});

test('CGPA counts finalized semesters; projected CGPA also counts drafts; retakes count normally', () => {
  const summary = summarize([
    { level: 200, semester: 1, status: 'finalized', courses: [{ units: 3, grade: 'F' }, { units: 3, grade: 'A' }] },
    { level: 200, semester: 2, status: 'finalized', courses: [{ units: 3, grade: 'B' }] }, // retake of the F
    { level: 300, semester: 1, status: 'draft', courses: [{ units: 4, grade: 'A' }, { units: 2, grade: null }] },
  ]);
  assert.equal(summary.cgpa, 3); // (0 + 15 + 12) / 9
  assert.equal(summary.units, 9);
  assert.equal(summary.projectedCgpa, 3.62); // (27 + 20) / 13
  assert.equal(summary.finalizedSemesters, 2);
  assert.equal(summary.draftSemesters, 1);
  assert.equal(summary.pendingCourses, 1);
  assert.equal(summary.degreeClass, 'Second Class Lower');
});

test('degree classes use the 5.0 bands', () => {
  assert.equal(degreeClass(4.5), 'First Class');
  assert.equal(degreeClass(4.49), 'Second Class Upper');
  assert.equal(degreeClass(3.5), 'Second Class Upper');
  assert.equal(degreeClass(2.4), 'Second Class Lower');
  assert.equal(degreeClass(1.5), 'Third Class');
  assert.equal(degreeClass(1.0), 'Pass');
  assert.equal(degreeClass(0.99), 'Below Pass');
  assert.equal(degreeClass(null), null);
});

test('course codes are normalised so spacing and case do not create duplicates', () => {
  assert.equal(normalizeCourseCode('pct201'), 'PCT 201');
  assert.equal(normalizeCourseCode(' PCT   201 '), 'PCT 201');
  assert.equal(normalizeCourseCode('gst 102b'), 'GST 102B');
  assert.equal(normalizeCourseCode('odd-code 1'), 'ODD-CODE 1');
  assert.equal(normalizeCourseCode('CHM-CM101'), 'CHM-CM 101');
  assert.equal(normalizeCourseCode('phy-cm 107'), 'PHY-CM 107');
});
