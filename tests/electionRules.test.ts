import test from 'node:test';
import assert from 'node:assert/strict';
import { canPerform, castHour, effectiveStatus, publishDecision, tally, validateBallot, validateSchedule } from '../src/modules/elections/domain/electionRules';
import { emailOnlyId, readVoterList } from '../src/modules/elections/domain/voterList';

const at = (iso: string) => new Date(iso);
const window = { opensAt: at('2026-10-16T08:00:00Z'), closesAt: at('2026-10-16T16:00:00Z') };

test('status follows the clock: opens and closes on time, even before the scheduler runs', () => {
  assert.equal(effectiveStatus({ ...window, status: 'ready' }, at('2026-10-16T07:59:59Z')), 'ready');
  assert.equal(effectiveStatus({ ...window, status: 'ready' }, at('2026-10-16T08:00:00Z')), 'open');
  assert.equal(effectiveStatus({ ...window, status: 'open' }, at('2026-10-16T15:59:59Z')), 'open');
  assert.equal(effectiveStatus({ ...window, status: 'open' }, at('2026-10-16T16:00:00Z')), 'closed');
  assert.equal(effectiveStatus({ ...window, status: 'paused' }, at('2026-10-16T17:00:00Z')), 'closed');
  assert.equal(effectiveStatus({ ...window, status: 'paused' }, at('2026-10-16T10:00:00Z')), 'paused');
  assert.equal(effectiveStatus({ ...window, status: 'draft' }, at('2026-10-16T10:00:00Z')), 'draft');
  assert.equal(effectiveStatus({ ...window, status: 'published' }, at('2026-10-16T10:00:00Z')), 'published');
});

test('separation of duties: developer sets up, committee runs, class reps have no access', () => {
  assert.equal(canPerform('dev', 'setup'), true);
  assert.equal(canPerform('dev', 'run'), false);
  assert.equal(canPerform('dev', 'previewResults'), false);
  assert.equal(canPerform('electoral_committee', 'run'), true);
  assert.equal(canPerform('electoral_committee', 'setup'), false);
  assert.equal(canPerform('electoral_committee', 'previewResults'), true);
  for (const role of ['cr', 'acr', 'fin_sec']) {
    for (const action of ['view', 'setup', 'run', 'previewResults', 'moderateVoters'] as const) assert.equal(canPerform(role, action), false, `${role} ${action}`);
  }
});

test('schedule validation', () => {
  assert.equal(validateSchedule(window.opensAt, window.closesAt), null);
  assert.match(validateSchedule(window.closesAt, window.opensAt)!, /close after it opens/);
  assert.match(validateSchedule(window.opensAt, at('2026-10-16T08:03:00Z'))!, /at least 5 minutes/);
  assert.match(validateSchedule(window.opensAt, window.closesAt, at('2026-10-17T00:00:00Z'))!, /registration deadline/);
});

const positions = [
  { id: 'pres', title: 'President', candidates: [{ id: 'a' }, { id: 'b' }] },
  { id: 'sec', title: 'General Secretary', candidates: [{ id: 'c' }] },
];

test('a ballot must answer every position with a candidate of that position', () => {
  assert.match((validateBallot(positions, [{ positionId: 'pres', candidateId: 'a' }]) as any).error, /General Secretary/);
  assert.match((validateBallot(positions, [{ positionId: 'pres', candidateId: 'c' }, { positionId: 'sec', candidateId: 'c', approve: true }]) as any).error, /not a candidate for that position/);
  assert.match((validateBallot(positions, [{ positionId: 'pres', candidateId: 'a' }, { positionId: 'pres', candidateId: 'b' }]) as any).error, /twice/);
  assert.match((validateBallot(positions, [{ positionId: 'pres', candidateId: 'a' }, { positionId: 'sec', candidateId: 'c' }]) as any).error, /Yes or No/);
  assert.match((validateBallot(positions, 'nope') as any).error, /empty/);
  const ok = validateBallot(positions, [{ positionId: 'sec', candidateId: 'c', approve: false }, { positionId: 'pres', candidateId: 'b', approve: true }]);
  assert.deepEqual(ok, { choices: [{ positionId: 'pres', candidateId: 'b', approve: null }, { positionId: 'sec', candidateId: 'c', approve: false }] });
});

test('results are ranked from most votes to least; ties are flagged, not broken', () => {
  const tallyPositions = [
    { id: 'pres', title: 'President', candidates: [{ id: 'a', displayName: 'Ada', nickname: null, photoUrl: null }, { id: 'b', displayName: 'Bola', nickname: null, photoUrl: null }, { id: 'x', displayName: 'Xavi', nickname: null, photoUrl: null }] },
    { id: 'sec', title: 'Secretary', candidates: [{ id: 'c', displayName: 'Chi', nickname: null, photoUrl: null }] },
    { id: 'tre', title: 'Treasurer', candidates: [{ id: 'd', displayName: 'Dayo', nickname: null, photoUrl: null }, { id: 'e', displayName: 'Ese', nickname: null, photoUrl: null }] },
  ];
  const choices = [
    ...Array(3).fill({ positionId: 'pres', candidateId: 'b', approve: null }),
    ...Array(1).fill({ positionId: 'pres', candidateId: 'a', approve: null }),
    ...Array(3).fill({ positionId: 'sec', candidateId: 'c', approve: true }),
    { positionId: 'sec', candidateId: 'c', approve: false },
    { positionId: 'tre', candidateId: 'd', approve: null }, { positionId: 'tre', candidateId: 'e', approve: null },
  ];
  const [pres, sec, tre] = tally(tallyPositions, choices);
  assert.deepEqual(pres.candidates.map((c) => [c.displayName, c.votes, c.rank, c.isWinner]), [['Bola', 3, 1, true], ['Ada', 1, 2, false], ['Xavi', 0, 3, false]]);
  assert.equal(pres.candidates[0].percent, 75);
  assert.equal(sec.unopposed, true);
  assert.deepEqual([sec.yes, sec.no, sec.candidates[0].isWinner], [3, 1, true]);
  assert.equal(tre.tie, true);
  assert.ok(tre.candidates.every((c) => !c.isWinner && c.rank === 1));
});

test('publishing needs both committee members, or one after 30 minutes', () => {
  const closed = at('2026-10-16T16:00:00Z');
  assert.equal(publishDecision(0, closed, at('2026-10-16T18:00:00Z')), 'blocked');
  assert.equal(publishDecision(1, closed, at('2026-10-16T16:10:00Z')), 'wait-for-second');
  assert.equal(publishDecision(1, closed, at('2026-10-16T16:30:00Z')), 'publish');
  assert.equal(publishDecision(2, closed, at('2026-10-16T16:01:00Z')), 'publish');
});

test('ballots keep only the hour', () => {
  assert.equal(castHour(at('2026-10-16T10:47:31.123Z')).toISOString(), '2026-10-16T10:00:00.000Z');
});

test('voter list: matric + name, optional email; email-only rows get a stable ID', () => {
  const { rows, errors } = readVoterList('matricNumber,fullName,email\n251106026,Yasir Oyebo,\n,Jupeb Student,JUPEB.one@Example.com\n');
  assert.deepEqual(errors, []);
  assert.equal(rows[0].matricNumber, '251106026');
  assert.equal(rows[0].email, null);
  assert.equal(rows[1].emailOnly, true);
  assert.equal(rows[1].email, 'jupeb.one@example.com');
  assert.equal(rows[1].matricNumber, emailOnlyId('jupeb.one@example.com'));
  assert.match(rows[1].matricNumber, /^JUPEB-[0-9A-F]{6}$/);
});

test('voter list: header aliases and every problem reported', () => {
  const ok = readVoterList('MATRIC NO,CANDIDATE FULL NAME\n251106049,Daniel Adegbite\n');
  assert.deepEqual(ok.errors, []);
  const bad = readVoterList('matric,name,email\n251106049,,\n251106049,Dup,\n,,\nxx yy!,Odd,not-an-email\n');
  assert.ok(bad.errors.some((e) => /name is missing/.test(e)));
  assert.ok(bad.errors.some((e) => /already on line/.test(e)));
  assert.ok(bad.errors.some((e) => /matric number or an email/.test(e)));
  assert.ok(bad.errors.some((e) => /not a valid email/.test(e)));
  assert.match(readVoterList('foo,bar\n1,2\n').errors[0], /header/);
});
