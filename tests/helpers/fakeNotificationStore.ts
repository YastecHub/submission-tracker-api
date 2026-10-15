import { randomUUID } from 'node:crypto';
import type { Notice, NoticeAudience, NoticeMessage } from '../../src/modules/elections/domain/electionNotices';
import type { ElectionNotificationRepository } from '../../src/modules/elections/infrastructure/electionNotificationRepository';
import type { createFakeElectionRepo } from './fakeElectionRepo';

type FakeDb = ReturnType<typeof createFakeElectionRepo>['db'];

/** In-memory stand-in for ElectionNotificationRepository, reading the fake election repo's data. */
export function createFakeNotificationStore(db: FakeDb) {
  const state = {
    notices: [] as Array<{ id: string; electionId: string; key: string; kind: string; sentByName: string | null; pushQueued: number; emailsSent: number; createdAt: Date }>,
    subscriptions: [] as Array<{ id: string; studentId: string }>,
    pushed: [] as Array<{ subscriptionId: string; message: NoticeMessage }>,
  };
  const store = {
    async activeElections() {
      return db.elections.filter((e) => !e.isTest && ['ready', 'open', 'paused', 'published'].includes(e.status));
    },
    async claim(electionId: string, notice: Notice, sentByName: string | null) {
      if (state.notices.some((n) => n.electionId === electionId && n.key === notice.key)) return null;
      const row = { id: randomUUID(), electionId, key: notice.key, kind: notice.kind, sentByName, pushQueued: 0, emailsSent: 0, createdAt: new Date() };
      state.notices.push(row);
      return { id: row.id };
    },
    async recipients(electionId: string, audience: NoticeAudience, registrationDeadline: Date | null) {
      const matrics = new Set(db.roll.filter((r) => r.electionId === electionId).map((r) => r.matricNumber));
      return db.students
        .filter((s) => matrics.has(s.matricNumber) && !s.suspendedAt)
        .filter((s) => audience === 'everyone' || !registrationDeadline || s.createdAt <= registrationDeadline)
        .filter((s) => audience !== 'notVoted' || !db.records.some((r) => r.electionId === electionId && r.studentId === s.id))
        .map((s) => ({ id: s.id, fullName: s.fullName, email: s.email, subscriptionIds: state.subscriptions.filter((x) => x.studentId === s.id).map((x) => x.id) }));
    },
    async enqueuePush(subscriptionIds: string[], message: NoticeMessage) {
      for (const subscriptionId of subscriptionIds) state.pushed.push({ subscriptionId, message });
    },
    async record(id: string, counts: { pushQueued?: number; emailsSent?: number }) {
      Object.assign(state.notices.find((n) => n.id === id)!, counts);
    },
    async history(electionId: string) {
      return state.notices.filter((n) => n.electionId === electionId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async lastReminderAt(electionId: string): Promise<Date | null> {
      const reminders = state.notices.filter((n) => n.electionId === electionId && n.kind === 'reminder');
      return reminders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdAt ?? null;
    },
  } satisfies Pick<ElectionNotificationRepository, 'activeElections' | 'claim' | 'recipients' | 'enqueuePush' | 'record' | 'history' | 'lastReminderAt'>;
  return { store, state };
}
