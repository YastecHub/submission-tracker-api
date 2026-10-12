import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { GpaService } from '../src/modules/gpa/application/gpaService';
import { GpaImportConflictError, type ImportSemesterPlan } from '../src/modules/gpa/infrastructure/gpaRepository';
import type { CourseInput } from '../src/modules/gpa/domain/semesterInput';
import { cacheDelete } from '../src/utils/cache';

type Status = 'draft' | 'finalized';
interface Semester {
  id: string; studentId: string; level: number; semester: number; sessionLabel: string | null; status: Status;
  finalizedAt: Date | null; version: number; createdAt: Date; updatedAt: Date;
  courses: Array<CourseInput & { id: string; semesterId: string }>;
}

/** In-memory stand-in for the Prisma repository, with the same student scoping. */
function fakeRepository() {
  let semesters: Semester[] = [];
  const catalog = [{ id: randomUUID(), code: 'PCT 201', title: 'Catalog Title', units: 3, level: 200, semester: 1, isElective: false }];
  const clone = <T>(value: T): T => structuredClone(value);
  const withCourses = (semester: Semester, courses: CourseInput[]) => {
    semester.courses = courses.map((course) => ({ ...course, id: randomUUID(), semesterId: semester.id }));
  };
  const repo = {
    calls: [] as string[],
    listSemesters: async (studentId: string) => clone(semesters.filter((s) => s.studentId === studentId).sort((a, b) => a.level - b.level || a.semester - b.semester)),
    findSemester: async (studentId: string, id: string) => clone(semesters.find((s) => s.id === id && s.studentId === studentId) ?? null),
    semesterIdExists: async (id: string) => semesters.some((s) => s.id === id),
    findSemesterBySlot: async (studentId: string, level: number, semester: number) => clone(semesters.find((s) => s.studentId === studentId && s.level === level && s.semester === semester) ?? null),
    listCatalog: async () => clone(catalog),
    existingCatalogIds: async (ids: string[]) => new Set(ids.filter((id) => catalog.some((c) => c.id === id))),
    createSemester: async (studentId: string, data: { id: string | null; level: number; semester: number; sessionLabel: string | null; courses: CourseInput[] }) => {
      if (data.id && semesters.some((s) => s.id === data.id)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
      }
      const now = new Date();
      const semester: Semester = { id: data.id ?? randomUUID(), studentId, level: data.level, semester: data.semester, sessionLabel: data.sessionLabel, status: 'draft', finalizedAt: null, version: 1, createdAt: now, updatedAt: now, courses: [] };
      withCourses(semester, data.courses);
      semesters.push(semester);
      return clone(semester);
    },
    replaceSemester: async (studentId: string, id: string, version: number, data: { sessionLabel: string | null; courses: CourseInput[] }) => {
      const semester = semesters.find((s) => s.id === id && s.studentId === studentId && s.version === version && s.status === 'draft');
      if (!semester) return null;
      semester.version += 1;
      semester.sessionLabel = data.sessionLabel;
      withCourses(semester, data.courses);
      return clone(semester);
    },
    setStatus: async (studentId: string, id: string, version: number, from: Status, to: Status) => {
      const semester = semesters.find((s) => s.id === id && s.studentId === studentId && s.version === version && s.status === from);
      if (!semester) return null;
      semester.status = to;
      semester.version += 1;
      semester.finalizedAt = to === 'finalized' ? new Date() : null;
      return clone(semester);
    },
    deleteSemester: async (studentId: string, id: string) => {
      const before = semesters.length;
      semesters = semesters.filter((s) => !(s.id === id && s.studentId === studentId));
      return semesters.length < before;
    },
    applyImport: async (studentId: string, plan: ImportSemesterPlan[]) => {
      repo.calls.push('applyImport');
      const snapshot = clone(semesters);
      try {
        for (const item of plan) {
          let semester: Semester;
          if (item.existingId) {
            const found = semesters.find((s) => s.id === item.existingId && s.studentId === studentId && s.version === item.expectedVersion && s.status === 'draft');
            if (!found) throw new GpaImportConflictError();
            semester = found;
            semester.version += 1;
            const codes = new Set(item.courses.map((c) => c.code));
            semester.courses = semester.courses.filter((c) => !codes.has(c.code));
          } else {
            semester = await repo.createSemester(studentId, { id: null, level: item.level, semester: item.semester, sessionLabel: item.sessionLabel, courses: [] }) as Semester;
            semester = semesters.find((s) => s.id === semester.id)!;
          }
          semester.courses.push(...item.courses.map((course) => ({ ...course, id: randomUUID(), semesterId: semester.id })));
          if (item.finalize) { semester.status = 'finalized'; semester.version += 1; }
        }
      } catch (error) {
        semesters = snapshot;
        throw error;
      }
      return repo.listSemesters(studentId);
    },
  };
  return { repo, catalog };
}

function setup() {
  cacheDelete('gpa:catalog');
  const { repo, catalog } = fakeRepository();
  return { service: new GpaService(repo as never), repo, catalog };
}

const course = (code: string, grade: string | null, units = 3) => ({ code, title: code, units, grade, isCarryover: false, isRetake: false });

test('a new semester starts as a draft and the record shows GPA and CGPA', async () => {
  const { service } = setup();
  const created = await service.createSemester('student-a', { level: 200, semester: 1, courses: [course('pct201', 'A'), course('PCT 202', 'C', 2)] });
  assert.equal(created.status, 'draft');
  assert.equal(created.courses[0].code, 'PCT 201');
  assert.equal(created.totals.gpa, 4.2);
  const record = await service.getRecord('student-a');
  assert.equal(record.summary.cgpa, null); // nothing finalized yet
  assert.equal(record.summary.projectedCgpa, 4.2);
});

test("students can never see or change another student's semesters", async () => {
  const { service } = setup();
  const mine = await service.createSemester('student-a', { level: 200, semester: 1, courses: [course('PCT 201', 'A')] });
  assert.deepEqual((await service.getRecord('student-b')).semesters, []);
  await assert.rejects(service.updateSemester('student-b', mine.id, { expectedVersion: 1, courses: [] }), (e: { statusCode?: number }) => e.statusCode === 404);
  await assert.rejects(service.finalizeSemester('student-b', mine.id, { expectedVersion: 1 }), (e: { statusCode?: number }) => e.statusCode === 404);
  await assert.rejects(service.deleteSemester('student-b', mine.id), (e: { statusCode?: number }) => e.statusCode === 404);
  // Re-using another student's id to "create" does not return their data.
  await assert.rejects(service.createSemester('student-b', { id: mine.id, level: 200, semester: 1, courses: [] }), (e: { statusCode?: number }) => e.statusCode === 409);
});

test('creating with the same client id twice is safe (offline retries)', async () => {
  const { service } = setup();
  const id = randomUUID();
  const first = await service.createSemester('student-a', { id, level: 300, semester: 2, courses: [course('PCT 301', 'B')] });
  const retry = await service.createSemester('student-a', { id, level: 300, semester: 2, courses: [course('PCT 301', 'B')] });
  assert.equal(retry.id, first.id);
  assert.equal((await service.getRecord('student-a')).semesters.length, 1);
  await assert.rejects(service.createSemester('student-a', { level: 300, semester: 2, courses: [] }), /already have 300L second semester/);
});

test('duplicate courses and bad grades are rejected with clear messages', async () => {
  const { service } = setup();
  await assert.rejects(service.createSemester('student-a', { level: 200, semester: 1, courses: [course('PCT 201', 'A'), course('pct201', 'B')] }), /listed twice/);
  await assert.rejects(service.createSemester('student-a', { level: 200, semester: 1, courses: [course('PCT 201', 'G')] }), /invalid grade/);
  await assert.rejects(service.createSemester('student-a', { level: 200, semester: 1, courses: [course('PCT 201', 'A', 0)] }), /between 1 and 12 units/);
  await assert.rejects(service.createSemester('student-a', { level: 700, semester: 1, courses: [] }), /Level must be/);
});

test('finalize needs every grade; finalized semesters are locked until unlocked', async () => {
  const { service } = setup();
  const created = await service.createSemester('student-a', { level: 200, semester: 1, courses: [course('PCT 201', 'A'), course('PCT 202', null)] });
  await assert.rejects(service.finalizeSemester('student-a', created.id, { expectedVersion: 1 }), /Add a grade for PCT 202/);
  const edited = await service.updateSemester('student-a', created.id, { expectedVersion: 1, courses: [course('PCT 201', 'A'), course('PCT 202', 'B')] });
  const finalized = await service.finalizeSemester('student-a', created.id, { expectedVersion: edited.version });
  assert.equal(finalized.status, 'finalized');
  assert.equal((await service.getRecord('student-a')).summary.cgpa, 4.5);

  await assert.rejects(service.updateSemester('student-a', created.id, { expectedVersion: finalized.version, courses: [] }), /finalized. Unlock it/);
  const unlocked = await service.unlockSemester('student-a', created.id, { expectedVersion: finalized.version });
  assert.equal(unlocked.status, 'draft');
  const corrected = await service.updateSemester('student-a', created.id, { expectedVersion: unlocked.version, courses: [course('PCT 201', 'B'), course('PCT 202', 'B')] });
  assert.equal(corrected.totals.gpa, 4);
});

test('saving an out-of-date version is refused instead of overwriting other changes', async () => {
  const { service } = setup();
  const created = await service.createSemester('student-a', { level: 200, semester: 1, courses: [course('PCT 201', 'A')] });
  await service.updateSemester('student-a', created.id, { expectedVersion: 1, courses: [course('PCT 201', 'B')] });
  await assert.rejects(
    service.updateSemester('student-a', created.id, { expectedVersion: 1, courses: [course('PCT 201', 'C')] }),
    (e: { statusCode?: number; message: string }) => e.statusCode === 409 && /another device/.test(e.message),
  );
});

test('catalog links that no longer exist are dropped but the copied course is kept', async () => {
  const { service, catalog } = setup();
  const created = await service.createSemester('student-a', { level: 200, semester: 1, courses: [
    { ...course('PCT 201', 'A'), catalogCourseId: catalog[0].id },
    { ...course('PCT 299', 'A'), catalogCourseId: randomUUID() },
  ] });
  assert.equal(created.courses[0].catalogCourseId, catalog[0].id);
  assert.equal(created.courses[1].catalogCourseId, null);
  assert.equal(created.courses[1].code, 'PCT 299');
});

test('CSV import: dry run previews without writing, commit writes everything at once', async () => {
  const { service, repo } = setup();
  const csv = [
    'level,semester,code,title,units,grade',
    '200,1,PCT 201,,,A', // units and title come from the catalog
    '200,1,PCT 205,Custom,2,B',
    '200,2,PCT 210,Other,3,', // pending grade: imported as a draft
  ].join('\n');

  const preview = await service.importCsv('student-a', { csv });
  assert.equal(preview.valid, true);
  assert.equal(preview.imported, false);
  assert.equal(repo.calls.length, 0);
  assert.deepEqual(preview.semesters.map((s) => [s.level, s.semester, s.added, s.willFinalize]), [[200, 1, 2, true], [200, 2, 1, false]]);
  assert.equal(preview.summaryAfterImport.cgpa, 4.6); // (15 + 8) / 5

  const committed = await service.importCsv('student-a', { csv, dryRun: false });
  assert.equal(committed.imported, true);
  const record = await service.getRecord('student-a');
  assert.equal(record.semesters.length, 2);
  assert.equal(record.semesters[0].courses.find((c) => c.code === 'PCT 201')?.title, 'Catalog Title');
  assert.equal(record.semesters[0].status, 'finalized');
  assert.equal(record.semesters[1].status, 'draft');
});

test('CSV import merges into a draft semester and refuses finalized ones', async () => {
  const { service } = setup();
  const draft = await service.createSemester('student-a', { level: 300, semester: 1, courses: [course('PCT 301', null), course('PCT 302', 'B')] });
  const done = await service.createSemester('student-a', { level: 200, semester: 1, courses: [course('PCT 201', 'A')] });
  await service.finalizeSemester('student-a', done.id, { expectedVersion: 1 });

  const blocked = await service.importCsv('student-a', { csv: 'level,semester,code,units,grade\n200,1,PCT 209,2,A\n300,1,PCT 301,3,A', dryRun: false });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.imported, false);
  assert.match(blocked.issues[0].message, /finalized. Unlock it/);

  const merged = await service.importCsv('student-a', { csv: 'level,semester,code,units,grade\n300,1,PCT 301,3,A', dryRun: false });
  assert.equal(merged.imported, true);
  const semester = (await service.getRecord('student-a')).semesters.find((s) => s.id === draft.id)!;
  assert.deepEqual(semester.courses.map((c) => [c.code, c.grade]).sort(), [['PCT 301', 'A'], ['PCT 302', 'B']]);
  assert.equal(semester.status, 'finalized');
});

test('CSV import needs units for courses that are not in the catalog', async () => {
  const { service } = setup();
  const result = await service.importCsv('student-a', { csv: 'level,semester,code,grade\n200,1,XYZ 101,A' });
  assert.equal(result.valid, false);
  assert.match(result.issues[0].message, /not in the course list, so its units are needed/);
});
