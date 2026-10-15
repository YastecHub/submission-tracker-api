import test from 'node:test';
import assert from 'node:assert/strict';
import { dueNotices, noticeMessage, reminderNotice, type NoticeElection } from '../src/modules/elections/domain/electionNotices';

const MIN = 60_000;
const NOW = new Date('2026-10-16T10:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);

function election(overrides: Partial<NoticeElection> = {}): NoticeElection {
  return { id: 'e1', title: 'Class Executives 2026', isTest: false, status: 'open', opensAt: at(-30), closesAt: at(300), openedAt: at(-30), publishedAt: null, ...overrides };
}
const keys = (e: NoticeElection, now = NOW) => dueNotices(e, now).map((notice) => notice.key);

test('voting is open: due while open with more than 10 minutes left; never for test elections or other states', () => {
  assert.deepEqual(keys(election()), ['opened']);
  assert.deepEqual(dueNotices(election(), NOW)[0], { key: 'opened', kind: 'opened', audience: 'canVote', email: true });
  assert.deepEqual(keys(election({ isTest: true })), []);
  assert.deepEqual(keys(election({ status: 'paused' })), []);
  assert.deepEqual(keys(election({ status: 'ready', opensAt: at(10) })), []);
  // A "ready" election whose opening time has passed counts as open (the scheduler may not have saved it yet).
  assert.deepEqual(keys(election({ status: 'ready', opensAt: at(-1), openedAt: null })), ['opened']);
});

test('closing reminders: 1 hour and 15 minutes before, only to non-voters, keyed by the closing time', () => {
  const e = election({ closesAt: at(45) });
  const notices = dueNotices(e, NOW);
  assert.deepEqual(notices.map((n) => n.kind), ['closing-60'], 'a missed "voting is open" is not sent on top of a reminder');
  assert.equal(notices[0].audience, 'notVoted');
  assert.equal(notices[0].key, `closing-60@${at(45).toISOString()}`);
  assert.deepEqual(keys(election({ closesAt: at(10) })), [`closing-15@${at(10).toISOString()}`]);
  assert.deepEqual(keys(election({ closesAt: at(0.5) })), [], 'too late for a reminder');
  assert.deepEqual(keys(election({ closesAt: at(-1) })), [], 'closed');
});

test('no closing reminder right after opening: "1 hour left" needs 75 minutes of voting, "15 minutes" needs 30', () => {
  assert.deepEqual(keys(election({ opensAt: at(-10), openedAt: at(-10), closesAt: at(50) })), ['opened']);
  assert.deepEqual(keys(election({ opensAt: at(-10), openedAt: at(-10), closesAt: at(14) })), ['opened']);
  assert.deepEqual(keys(election({ opensAt: at(-20), openedAt: at(-20), closesAt: at(12) })), [`closing-15@${at(12).toISOString()}`]);
});

test('results: only for results published in the last 6 hours', () => {
  assert.deepEqual(keys(election({ status: 'published', closesAt: at(-60), publishedAt: at(-5) })), ['results']);
  assert.equal(dueNotices(election({ status: 'published', closesAt: at(-60), publishedAt: at(-5) }), NOW)[0].audience, 'everyone');
  assert.deepEqual(keys(election({ status: 'published', closesAt: at(-600), publishedAt: at(-7 * 60) })), []);
});

test('two committee members pressing remind in the same half hour share one key', () => {
  assert.equal(reminderNotice(new Date('2026-10-16T10:01:00Z')).key, reminderNotice(new Date('2026-10-16T10:29:00Z')).key);
  assert.notEqual(reminderNotice(new Date('2026-10-16T10:29:00Z')).key, reminderNotice(new Date('2026-10-16T10:31:00Z')).key);
});

test('messages name the election, the Lagos closing time and link to its page', () => {
  const message = noticeMessage('opened', { id: 'e1', title: 'Class Executives 2026', closesAt: new Date('2026-10-16T15:00:00Z') });
  assert.equal(message.title, 'Voting is open');
  assert.match(message.body, /Class Executives 2026: vote before 4:00\s?pm/i);
  assert.equal(message.url, '/student/elections/e1');
  assert.equal(message.tag, 'election-e1-opened');
});
