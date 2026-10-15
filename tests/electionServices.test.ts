import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ElectionAdminService } from '../src/modules/elections/application/electionAdminService';
import { StudentElectionService } from '../src/modules/elections/application/studentElectionService';
import { createFakeElectionRepo } from './helpers/fakeElectionRepo';
import { createFakeNotificationStore } from './helpers/fakeNotificationStore';
import { ElectionNotifier } from '../src/modules/elections/application/electionNotifier';
import { loadClassList } from '../src/modules/elections/infrastructure/classList';
import { readVoterList } from '../src/modules/elections/domain/voterList';

const dev = { id: 'dev-1', name: 'Yasir', role: 'dev' };
const officerA = { id: 'ec-1', name: 'Roqeeb', role: 'electoral_committee' };
const officerB = { id: 'ec-2', name: 'Member Two', role: 'electoral_committee' };
const rep = { id: 'cr-1', name: 'Class Rep', role: 'cr' };
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const receipt = () => Array.from({ length: 10 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('');

async function setup() {
  const { repo, db } = createFakeElectionRepo();
  db.users.push({ id: officerA.id, name: officerA.name, email: 'a@x.test', role: 'electoral_committee', createdAt: new Date() });
  db.users.push({ id: officerB.id, name: officerB.name, email: 'b@x.test', role: 'electoral_committee', createdAt: new Date() });
  const announced: string[] = [];
  const notices = createFakeNotificationStore(db);
  const emails: string[] = [];
  const notifier = new ElectionNotifier(notices.store, {
    pushEnabled: () => true, emailEnabled: () => true, deliverNow: () => {}, emailGapMs: 0, emailCap: 1,
    sendEmail: async (_name, email) => { emails.push(email); },
  });
  const admin = new ElectionAdminService(repo, async () => ({ url: 'https://img.test/p.jpg', publicId: 'p' }), (id) => announced.push(id), () => [], notifier);
  const votes: string[] = [];
  const students = new StudentElectionService(repo, (studentId) => votes.push(studentId));
  let election = await admin.create(dev, { title: 'Class Executives 2026', opensAt: minutes(60), closesAt: minutes(240) });
  election = await admin.addPosition(dev, election.id, { title: 'President' });
  election = await admin.addPosition(dev, election.id, { title: 'General Secretary' });
  const [pres, sec] = election.positions;
  await admin.addCandidate(dev, election.id, { positionId: pres.id, displayName: 'Ada Lovelace', matricNumber: '251106001' });
  await admin.addCandidate(dev, election.id, { positionId: pres.id, displayName: 'Bola Tinubu' });
  election = await admin.addCandidate(dev, election.id, { positionId: sec.id, displayName: 'Chi Okafor', manifesto: 'Transparency' }, { buffer: Buffer.from('x') });
  const preview = await admin.uploadVoters(dev, election.id, { csv: 'matricNumber,fullName,email\n251106001,Ada Lovelace,\n251106002,Bayo Ade,\n,Jupeb One,jupeb1@x.test\n' });
  assert.equal(preview.applied, false);
  const applied = await admin.uploadVoters(dev, election.id, { csv: 'matricNumber,fullName,email\n251106001,Ada Lovelace,\n251106002,Bayo Ade,\n,Jupeb One,jupeb1@x.test\n', dryRun: false });
  assert.equal(applied.applied, true);
  db.students.push({ id: 's1', matricNumber: '251106001', fullName: 'Ada Lovelace', email: 'ada@x.test', createdAt: new Date(Date.now() - 86_400_000), suspendedAt: null, suspendedReason: null });
  db.students.push({ id: 's2', matricNumber: '251106002', fullName: 'Bayo Ade', email: 'bayo@x.test', createdAt: new Date(Date.now() - 86_400_000), suspendedAt: null, suspendedReason: null });
  db.students.push({ id: 's9', matricNumber: '251106099', fullName: 'Not On List', email: 'x@x.test', createdAt: new Date(), suspendedAt: null, suspendedReason: null });
  election = await admin.detail(dev, election.id);
  return { repo, db, admin, students, election, announced, votes, notices, notifier, emails };
}

function ballot(election: any, presIndex = 0, approve = true) {
  const [pres, sec] = election.positions;
  return { requestId: randomUUID(), receiptCode: receipt(), choices: [
    { positionId: pres.id, candidateId: pres.candidates[presIndex].id },
    { positionId: sec.id, candidateId: sec.candidates[0].id, approve },
  ] };
}

async function openNow(ctx: Awaited<ReturnType<typeof setup>>) {
  await ctx.admin.markReady(dev, ctx.election.id);
  await ctx.admin.open(officerA, ctx.election.id);
}

test('roles: class reps get nothing, the developer cannot run it, the committee cannot set it up', async () => {
  const ctx = await setup();
  await assert.rejects(ctx.admin.list(rep), /electoral committee/);
  await assert.rejects(ctx.admin.addPosition(officerA, ctx.election.id, { title: 'Treasurer' }), /developer/);
  await ctx.admin.markReady(dev, ctx.election.id);
  await assert.rejects(ctx.admin.open(dev, ctx.election.id), /electoral committee/);
  await assert.rejects(ctx.admin.addPosition(dev, ctx.election.id, { title: 'Treasurer' }), /locked/);
});

test('cannot lock an election with an empty position or no voters', async () => {
  const { admin } = await setup();
  let e = await admin.create(dev, { title: 'Empty', opensAt: minutes(60), closesAt: minutes(120) });
  await assert.rejects(admin.markReady(dev, e.id), /at least one position/);
  e = await admin.addPosition(dev, e.id, { title: 'President' });
  await assert.rejects(admin.markReady(dev, e.id), /Add a candidate for President/);
  await admin.addCandidate(dev, e.id, { positionId: e.positions[0].id, displayName: 'Solo' });
  await assert.rejects(admin.markReady(dev, e.id), /voter list/);
});

test('a student votes once; a retry of the same ballot is "recorded", a second ballot is refused', async () => {
  const ctx = await setup();
  // Hidden from students while in setup; visible but not votable once locked.
  await assert.rejects(ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election)), /not found/);
  await ctx.admin.markReady(dev, ctx.election.id);
  await assert.rejects(ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election)), /not opened yet/);
  await ctx.admin.open(officerA, ctx.election.id);
  const first = ballot(ctx.election);
  const result = await ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, first);
  assert.equal(result.recorded, true);
  assert.equal(result.repeated, false);
  assert.deepEqual(ctx.votes, ['s1']);
  const retry = await ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, first);
  assert.equal(retry.repeated, true);
  await assert.rejects(ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election, 1)), /already voted/);
  assert.equal(ctx.db.records.length, 1);
  assert.equal(ctx.db.ballots.length, 1);
  // Secret ballot: nothing on the ballot points to the student.
  assert.ok(!JSON.stringify(ctx.db.ballots).includes('s1'));
  assert.ok(!JSON.stringify(ctx.db.ballots).includes('251106001'));
});

test('a ballot must answer every position', async () => {
  const ctx = await setup();
  await openNow(ctx);
  const partial = ballot(ctx.election);
  partial.choices = partial.choices.slice(0, 1);
  await assert.rejects(ctx.students.vote({ id: 's2', matricNumber: '251106002' }, ctx.election.id, partial), /General Secretary/);
  assert.equal(ctx.db.records.length, 0);
});

test('students not on the list, suspended or registered after the deadline cannot vote', async () => {
  const ctx = await setup();
  await openNow(ctx);
  await assert.rejects(ctx.students.detail({ id: 's9', matricNumber: '251106099' }, ctx.election.id), /not found/);
  await assert.rejects(ctx.students.vote({ id: 's9', matricNumber: '251106099' }, ctx.election.id, ballot(ctx.election)), /not found/);
  await ctx.admin.suspendStudent(officerA, ctx.election.id, 's2', { reason: 'Registered with another student\'s matric number' });
  await assert.rejects(ctx.students.vote({ id: 's2', matricNumber: '251106002' }, ctx.election.id, ballot(ctx.election)), /suspended/);
  const e = ctx.db.elections[0];
  e.registrationDeadline = new Date(Date.now() - 2 * 86_400_000);
  await assert.rejects(ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election)), /Registration for this election closed/);
});

test('pause, extend (never shorten), close; results hidden until closed and only the committee previews', async () => {
  const ctx = await setup();
  await openNow(ctx);
  await ctx.admin.pause(officerA, ctx.election.id);
  await assert.rejects(ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election)), /paused/);
  await ctx.admin.resume(officerB, ctx.election.id);
  const closesAt = ctx.db.elections[0].closesAt as Date;
  await assert.rejects(ctx.admin.extend(officerA, ctx.election.id, { closesAt: new Date(closesAt.getTime() - 60_000).toISOString() }), /never be shortened/);
  await ctx.admin.extend(officerA, ctx.election.id, { closesAt: new Date(closesAt.getTime() + 30 * 60_000).toISOString() });
  await ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election, 1));
  await assert.rejects(ctx.admin.results(officerA, ctx.election.id), /once voting closes/);
  await ctx.admin.close(officerA, ctx.election.id);
  await assert.rejects(ctx.students.vote({ id: 's2', matricNumber: '251106002' }, ctx.election.id, ballot(ctx.election)), /closed/);
  await assert.rejects(ctx.admin.results(dev, ctx.election.id), /once the committee publishes/);
  const preview = await ctx.admin.results(officerA, ctx.election.id);
  assert.equal(preview.integrity.ok, true);
  assert.equal(preview.positions[0].candidates[0].displayName, 'Bola Tinubu');
  await assert.rejects(ctx.students.results({ id: 's1', matricNumber: '251106001' }, ctx.election.id), /not out yet/);
});

test('publishing needs both committee members; results then go to students with receipts checkable', async () => {
  const ctx = await setup();
  await openNow(ctx);
  const mine = ballot(ctx.election);
  await ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, mine);
  await ctx.admin.close(officerA, ctx.election.id);
  const first = await ctx.admin.approvePublish(officerA, ctx.election.id);
  assert.equal(first.published, false);
  assert.equal(first.decision, 'wait-for-second');
  const again = await ctx.admin.approvePublish(officerA, ctx.election.id);
  assert.equal(again.published, false, 'the same member approving twice does not count');
  const second = await ctx.admin.approvePublish(officerB, ctx.election.id);
  assert.equal(second.published, true);
  const results = await ctx.students.results({ id: 's2', matricNumber: '251106002' }, ctx.election.id);
  assert.equal(results.turnout.voted, 1);
  assert.equal(results.turnout.eligible, 3);
  assert.deepEqual(await ctx.students.checkReceipt({ id: 's1', matricNumber: '251106001' }, ctx.election.id, { receiptCode: mine.receiptCode.toLowerCase() }), { counted: true });
  assert.deepEqual(await ctx.students.checkReceipt({ id: 's1', matricNumber: '251106001' }, ctx.election.id, { receiptCode: 'ABCDEFGHJK' }), { counted: false });
});

test('the integrity check blocks publishing when ballots and voters disagree', async () => {
  const ctx = await setup();
  await openNow(ctx);
  await ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election));
  await ctx.admin.close(officerA, ctx.election.id);
  ctx.db.ballots.push({ ...ctx.db.ballots[0], id: 'forged', receiptHash: 'forged' });
  await assert.rejects(ctx.admin.approvePublish(officerA, ctx.election.id), /Integrity check failed/);
});

test('candidate typos can be fixed while voting is open; candidates cannot be added', async () => {
  const ctx = await setup();
  await openNow(ctx);
  const candidate = ctx.election.positions[0].candidates[1];
  const updated = await ctx.admin.updateCandidate(dev, ctx.election.id, candidate.id, { displayName: 'Bola Tinubu Jr' });
  assert.equal(updated.positions[0].candidates[1].displayName, 'Bola Tinubu Jr');
  await assert.rejects(ctx.admin.addCandidate(dev, ctx.election.id, { positionId: ctx.election.positions[0].id, displayName: 'Late' }), /locked/);
  await assert.rejects(ctx.admin.updateCandidate(dev, ctx.election.id, candidate.id, { positionId: ctx.election.positions[1].id }), /cannot move/);
  assert.ok(ctx.db.audit.some((entry) => entry.action === 'candidate-edited'));
});

test('a real election with votes cannot be deleted; a test election can', async () => {
  const ctx = await setup();
  await openNow(ctx);
  await ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election));
  await assert.rejects(ctx.admin.remove(dev, ctx.election.id), /cannot be deleted/);
  ctx.db.elections[0].isTest = true;
  assert.deepEqual(await ctx.admin.remove(dev, ctx.election.id), { deleted: true });
});

test('after locking, the developer can only add voters (late corrections), never remove', async () => {
  const ctx = await setup();
  await ctx.admin.markReady(dev, ctx.election.id);
  const result = await ctx.admin.uploadVoters(dev, ctx.election.id, { csv: 'matric,name\n251106042,Late Student\n', dryRun: false });
  assert.equal(result.mode, 'add');
  assert.equal(result.removed, 0);
  assert.equal(ctx.db.roll.length, 4);
});

test('a new election starts with the whole class list as its voter list', async () => {
  const { repo } = createFakeElectionRepo();
  const classList = readVoterList('matricNumber,fullName,email\n251106001,"ADEGOKE, Adebusola Faith",\n,Jupeb One,jupeb1@x.test\n').rows;
  const notifier = new ElectionNotifier(createFakeNotificationStore(createFakeElectionRepo().db).store, { pushEnabled: () => false, emailEnabled: () => false });
  const admin = new ElectionAdminService(repo, async () => ({ url: '', publicId: '' }), () => {}, () => classList, notifier);
  const election = await admin.create(dev, { title: 'Class Executives 2026', opensAt: minutes(60), closesAt: minutes(240) });
  const roll = await repo.rollMatrics(election.id);
  assert.equal(roll.size, 2);
  assert.ok(roll.has('251106001'));
  assert.equal(election.counts.voters, 2);
});

test('the seeded class list file is valid: 126 students with matric numbers plus the JUPEB students by email', () => {
  const rows = loadClassList();
  assert.equal(rows.filter((row) => !row.emailOnly).length, 126);
  assert.equal(rows.filter((row) => row.emailOnly).length, 12);
  assert.ok(rows.filter((row) => row.emailOnly).every((row) => row.email && row.matricNumber.startsWith('JUPEB-')));
  assert.equal(new Set(rows.map((row) => row.matricNumber)).size, rows.length);
  assert.equal(rows.find((row) => row.matricNumber === '251106026')?.fullName, 'OYEBO, Yasir Oladimeji');
  assert.ok(rows.some((row) => row.matricNumber === '240706016'));
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('"voting is open": every phone of students who can vote, plus an email (capped) to those without push; sent once', async () => {
  const ctx = await setup();
  ctx.notices.state.subscriptions.push({ id: 'phone-a', studentId: 's1' }, { id: 'laptop-a', studentId: 's1' });
  await openNow(ctx);
  await ctx.notifier.runDue();
  await settle();
  assert.deepEqual(ctx.notices.state.pushed.map((push) => push.subscriptionId).sort(), ['laptop-a', 'phone-a']);
  assert.equal(ctx.notices.state.pushed[0].message.title, 'Voting is open');
  assert.equal(ctx.notices.state.pushed[0].message.url, `/student/elections/${ctx.election.id}`);
  assert.deepEqual(ctx.emails, ['bayo@x.test'], 'only the student without push gets the email');
  await ctx.notifier.runDue();
  assert.equal(ctx.notices.state.pushed.length, 2, 'never sent twice');
  const detail = await ctx.admin.detail(officerA, ctx.election.id);
  assert.deepEqual(detail.notifications.map((n) => [n.kind, n.pushQueued, n.emailsSent]), [['opened', 2, 1]]);
});

test('committee reminder: only students who have not voted, at most every 30 minutes, never for a test election', async () => {
  const ctx = await setup();
  ctx.notices.state.subscriptions.push({ id: 'phone-a', studentId: 's1' }, { id: 'phone-b', studentId: 's2' });
  await assert.rejects(ctx.admin.remind(officerA, ctx.election.id), /only be sent while voting is open/);
  await openNow(ctx);
  await ctx.students.vote({ id: 's1', matricNumber: '251106001' }, ctx.election.id, ballot(ctx.election));
  ctx.notices.state.pushed.length = 0;
  await assert.rejects(ctx.admin.remind(dev, ctx.election.id), /electoral committee/);
  const detail = await ctx.admin.remind(officerA, ctx.election.id);
  assert.deepEqual(ctx.notices.state.pushed.map((push) => push.subscriptionId), ['phone-b']);
  assert.equal(ctx.notices.state.pushed[0].message.title, "You haven't voted yet");
  assert.equal(detail.notifications[0].sentBy, officerA.name);
  assert.ok(detail.reminderAvailableAt && new Date(detail.reminderAvailableAt).getTime() > Date.now() + 29 * 60_000);
  await assert.rejects(ctx.admin.remind(officerB, ctx.election.id), /next one can go at/);
  assert.ok(ctx.db.audit.some((entry: any) => entry.action === 'reminder-sent'));
  ctx.db.elections[0].isTest = true;
  await assert.rejects(ctx.admin.remind(officerA, ctx.election.id), /Test elections/);
});

test('results notice goes to everyone on the list with an account, including students who voted', async () => {
  const ctx = await setup();
  ctx.notices.state.subscriptions.push({ id: 'phone-a', studentId: 's1' }, { id: 'phone-b', studentId: 's2' });
  const election = ctx.db.elections[0];
  Object.assign(election, { status: 'published', publishedAt: new Date() });
  await ctx.notifier.runDue();
  assert.deepEqual(ctx.notices.state.pushed.map((push) => [push.subscriptionId, push.message.title]), [['phone-a', 'Results are out'], ['phone-b', 'Results are out']]);
  assert.equal(ctx.emails.length, 0, 'only "voting is open" is emailed');
});
