import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  birthdayProblem, birthdaysCelebratedOn, daysUntil, displayName, formatBirthday, greetingName, isBirthdayToday, lagosToday,
} from '../src/modules/birthdays/domain/birthdayRules';
import { StudentBirthdayService } from '../src/modules/birthdays/application/studentBirthdayService';
import { BirthdayStaffService } from '../src/modules/birthdays/application/birthdayStaffService';
import { BirthdayCelebrator } from '../src/modules/birthdays/application/birthdayCelebrator';

// ---- Rules ------------------------------------------------------------------

test('birthday validation: real dates only, 29 February allowed', () => {
  assert.equal(birthdayProblem(3, 14), null);
  assert.equal(birthdayProblem(2, 29), null);
  assert.match(birthdayProblem(2, 30)!, /February only has 29 days/);
  assert.match(birthdayProblem(4, 31)!, /April only has 30 days/);
  assert.match(birthdayProblem(13, 1)!, /month/);
  assert.match(birthdayProblem(5, 0)!, /day/);
  assert.equal(formatBirthday({ month: 3, day: 14 }), '14 March');
});

test('Lagos time: 23:30 UTC is already the next day at 00:30 in Lagos', () => {
  assert.deepEqual(lagosToday(new Date('2026-03-13T23:30:00Z')), { year: 2026, month: 3, day: 14, hour: 0 });
  assert.equal(lagosToday(new Date('2026-03-14T06:00:00Z')).hour, 7);
});

test('29 February birthdays are celebrated on 28 February in non-leap years', () => {
  assert.deepEqual(birthdaysCelebratedOn({ year: 2027, month: 2, day: 28 }), [{ month: 2, day: 28 }, { month: 2, day: 29 }]);
  assert.deepEqual(birthdaysCelebratedOn({ year: 2028, month: 2, day: 28 }), [{ month: 2, day: 28 }]);
  assert.equal(isBirthdayToday({ month: 2, day: 29 }, { year: 2027, month: 2, day: 28 }), true);
  assert.equal(isBirthdayToday({ month: 2, day: 29 }, { year: 2028, month: 2, day: 29 }), true);
});

test('days until the next birthday, across the new year', () => {
  assert.equal(daysUntil({ month: 10, day: 28 }, { year: 2026, month: 10, day: 28 }), 0);
  assert.equal(daysUntil({ month: 11, day: 2 }, { year: 2026, month: 10, day: 28 }), 5);
  assert.equal(daysUntil({ month: 1, day: 2 }, { year: 2026, month: 12, day: 30 }), 3);
});

test('names: the preferred name wins; class-list names read "Firstname Surname"', () => {
  assert.equal(displayName('OYEBO, Yasir Oladimeji', null), 'Yasir Oyebo');
  assert.equal(displayName('EKEOCHA-PATRICK, Divine-Monica Kamsiyochukwu', null), 'Divine-Monica Ekeocha-Patrick');
  assert.equal(displayName('OYEBO, Yasir Oladimeji', 'Yas'), 'Yas');
  assert.equal(displayName('Iragbonse Joanne', null), 'Iragbonse Joanne');
  assert.equal(greetingName('OYEBO, Yasir Oladimeji', null), 'Yasir');
  assert.equal(greetingName('Aderibigbe Emmanuel', 'Emmy'), 'Emmy');
});

// ---- Fakes -----------------------------------------------------------------

const students = [
  { id: 's1', fullName: 'OYEBO, Yasir Oladimeji', matricNumber: '251106026', email: 'yasir@x.test' },
  { id: 's2', fullName: 'ENIOLORUNDA, Victoria', matricNumber: '251106093', email: 'vic@x.test' },
  { id: 's3', fullName: 'Iragbonse Joanne', matricNumber: 'JUPEB-AAAAAA', email: 'joanne@x.test' },
];

function fakeStore() {
  const birthdays: any[] = [];
  const claims = new Set<string>();
  const pushed: Array<{ ids: string[]; title: string }> = [];
  const subs: Record<string, string[]> = { s1: ['p1'], s2: ['p2a', 'p2b'], s3: [] };
  const withStudent = (b: any) => ({ ...b, student: students.find((s) => s.id === b.studentId)! });
  const store = {
    findForStudent: async (studentId: string) => birthdays.find((b) => b.studentId === studentId) ?? null,
    upsert: async (studentId: string, data: any) => {
      const existing = birthdays.find((b) => b.studentId === studentId);
      if (existing) Object.assign(existing, data, { updatedAt: new Date() });
      else birthdays.push({ id: `b-${studentId}`, studentId, photoUrl: null, photoPublicId: null, createdAt: new Date(), updatedAt: new Date(), ...data });
      return birthdays.find((b) => b.studentId === studentId);
    },
    onDates: async (dates: Array<{ month: number; day: number }>) =>
      birthdays.filter((b) => dates.some((d) => d.month === b.month && d.day === b.day)).map(withStudent),
    all: async () => [...birthdays].sort((a, b) => a.month - b.month || a.day - b.day).map(withStudent),
    studentsWithoutBirthday: async () => students.filter((s) => !birthdays.some((b) => b.studentId === s.id)).map((s) => ({ fullName: s.fullName, matricNumber: s.matricNumber })),
    countStudents: async () => students.length,
    claimCelebration: async (studentId: string, year: number, kind: string) => {
      const key = `${studentId}:${year}:${kind}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    releaseCelebration: async (studentId: string, year: number, kind: string) => { claims.delete(`${studentId}:${year}:${kind}`); },
    classmateSubscriptions: async (exclude: string[]) => Object.entries(subs).filter(([id]) => !exclude.includes(id)).flatMap(([, ids]) => ids),
    studentSubscriptions: async (studentId: string) => subs[studentId] ?? [],
    enqueuePush: async (ids: string[], message: { title: string }) => { if (ids.length) pushed.push({ ids, title: message.title }); return ids.length; },
  };
  return { store, birthdays, pushed };
}

// ---- Students ----------------------------------------------------------------

test('students save the form; a photo is optional; classmates celebrating today are listed if they share', async () => {
  const { store } = fakeStore();
  const uploads: number[] = [];
  const service = new StudentBirthdayService(store as any, async (buffer) => { uploads.push(buffer.length); return { url: 'https://img.test/b.jpg', publicId: 'b' }; });
  const now = new Date('2026-03-14T09:00:00Z');
  await assert.rejects(service.save(students[0], { month: '2', day: '30' }), /February only has 29 days/);
  const saved = await service.save(students[0], { month: '3', day: '14', preferredName: '  Yas  ', shareWithClass: 'true' }, { buffer: Buffer.from('jpg') });
  assert.equal(saved.birthday!.label, '14 March');
  assert.equal(saved.birthday!.preferredName, 'Yas');
  assert.equal(saved.birthday!.photoUrl, 'https://img.test/b.jpg');
  assert.deepEqual(uploads, [3]);
  await service.save(students[1], { month: '3', day: '14', shareWithClass: 'true' });
  await service.save(students[2], { month: '3', day: '14', shareWithClass: 'false' });
  const yasir = await service.mine(students[0], now);
  assert.equal(yasir.isMyBirthday, true);
  assert.equal(yasir.greetingName, 'Yas');
  assert.deepEqual(yasir.today.map((entry) => entry.name), ['Victoria Eniolorunda'], 'Joanne chose not to share; Yasir is not listed to himself');
  // Editing keeps the photo unless asked to remove it.
  const edited = await service.save(students[0], { month: '3', day: '15' });
  assert.equal(edited.birthday!.photoUrl, 'https://img.test/b.jpg');
  const removed = await service.save(students[0], { month: '3', day: '15', removePhoto: 'true' });
  assert.equal(removed.birthday!.photoUrl, null);
});

// ---- Celebrations ------------------------------------------------------------

test('celebrations: email from midnight; 7 am own notification; 8 am classmates only if shared; once a year', async () => {
  const { store, birthdays, pushed } = fakeStore();
  birthdays.push(
    { studentId: 's1', month: 3, day: 14, preferredName: null, shareWithClass: true },
    { studentId: 's3', month: 3, day: 14, preferredName: 'Jo', shareWithClass: false },
  );
  const emails: string[] = [];
  const celebrator = new BirthdayCelebrator(store as any, {
    sendEmail: async (name, email) => { emails.push(`${name}<${email}>`); },
    emailEnabled: () => true, pushEnabled: () => true, deliverNow: () => {},
  });
  await celebrator.runDue(new Date('2026-03-13T22:30:00Z')); // 23:30 Lagos the day before
  assert.equal(emails.length + pushed.length, 0);
  await celebrator.runDue(new Date('2026-03-13T23:10:00Z')); // 00:10 Lagos on the day
  assert.deepEqual(emails, ['Yasir<yasir@x.test>', 'Jo<joanne@x.test>'], 'emails wait in the inbox from midnight');
  assert.equal(pushed.length, 0, 'no phone buzzing at night');
  await celebrator.runDue(new Date('2026-03-14T06:05:00Z')); // 07:05 Lagos
  assert.deepEqual(pushed, [{ ids: ['p1'], title: 'Happy birthday, Yasir! 🎂' }]);
  await celebrator.runDue(new Date('2026-03-14T07:10:00Z')); // 08:10 Lagos
  assert.deepEqual(pushed.at(-1), { ids: ['p2a', 'p2b'], title: "🎉 It's Yasir Oyebo's birthday today!" });
  assert.equal(pushed.filter((push) => push.title.includes('Jo')).length, 0, 'Joanne chose not to share');
  await celebrator.runDue(new Date('2026-03-14T10:00:00Z'));
  assert.equal(emails.length, 2, 'never twice');
  assert.equal(pushed.length, 2, 'never twice');
});

test('a failed birthday email is retried on the next check', async () => {
  const { store, birthdays } = fakeStore();
  birthdays.push({ studentId: 's1', month: 3, day: 14, preferredName: null, shareWithClass: true });
  let attempts = 0;
  const celebrator = new BirthdayCelebrator(store as any, {
    sendEmail: async () => { attempts += 1; if (attempts === 1) throw new Error('Resend is down'); },
    emailEnabled: () => true, pushEnabled: () => false, deliverNow: () => {},
  });
  await celebrator.runDue(new Date('2026-03-14T00:00:00Z'));
  await celebrator.runDue(new Date('2026-03-14T00:05:00Z'));
  await celebrator.runDue(new Date('2026-03-14T00:10:00Z'));
  assert.equal(attempts, 2, 'failed once, sent on the retry, then never again');
});

test('class reps get flowers on the staff dashboard too (matched to their student account by email)', async () => {
  const { store, birthdays } = fakeStore();
  birthdays.push({ studentId: 's1', month: 10, day: 29, preferredName: null, shareWithClass: true });
  const service = new StudentBirthdayService({
    ...store,
    findStudentByEmail: async (email: string) => {
      const student = students.find((s) => s.email.toLowerCase() === email.toLowerCase());
      return student ? { id: student.id, fullName: student.fullName, birthday: birthdays.find((b) => b.studentId === student.id) ?? null } : null;
    },
  } as any);
  const onTheDay = new Date('2026-10-29T08:00:00Z');
  assert.deepEqual(await service.forStaff({ email: 'YASIR@x.test', name: 'Yasir (CR)' }, onTheDay), { isMyBirthday: true, greetingName: 'Yasir' });
  assert.equal((await service.forStaff({ email: 'yasir@x.test', name: 'Yasir' }, new Date('2026-10-30T08:00:00Z'))).isMyBirthday, false);
  assert.deepEqual(await service.forStaff({ email: 'other@x.test', name: 'Other Rep' }, onTheDay), { isMyBirthday: false, greetingName: 'Other' });
});

// ---- Staff ---------------------------------------------------------------------

test('staff overview and Excel export for the media team', async () => {
  const { store, birthdays } = fakeStore();
  birthdays.push(
    { studentId: 's2', month: 10, day: 30, preferredName: null, shareWithClass: true, photoUrl: 'https://img.test/v.jpg', updatedAt: new Date('2026-10-28T10:00:00Z') },
    { studentId: 's1', month: 1, day: 5, preferredName: 'Yas', shareWithClass: false, photoUrl: null, updatedAt: new Date('2026-10-28T11:00:00Z') },
  );
  const service = new BirthdayStaffService(store as any);
  const now = new Date('2026-10-28T12:00:00Z');
  const overview = await service.overview(now);
  assert.deepEqual(overview.counts, { answered: 2, students: 3 });
  assert.deepEqual(overview.rows.map((row) => row.birthday), ['5 January', '30 October']);
  assert.deepEqual(overview.upcoming.map((row) => [row.displayName, row.daysUntil]), [['Victoria Eniolorunda', 2]]);
  assert.deepEqual(overview.notAnswered.map((row) => row.matricNumber), ['JUPEB-AAAAAA']);
  const { buffer, filename } = await service.export(now);
  assert.equal(filename, 'nexium-birthdays-2026-10-28.xlsx');
  const sheet = XLSX.read(buffer).Sheets.Birthdays;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  assert.equal(rows[0]['Preferred name'], 'Yas');
  assert.equal(rows[0].Photo, 'No photo: ask on the day');
  assert.equal(rows[1].Birthday, '30 October');
  assert.equal(rows[1]['Tell classmates'], 'Yes');
});
