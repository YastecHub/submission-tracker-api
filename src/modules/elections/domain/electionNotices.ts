import { effectiveStatus, type ElectionStatus } from './electionRules';

/**
 * Election notices: what to tell students, when, and who gets it.
 *  - "opened":     everyone who can vote, when voting opens (plus the email backup).
 *  - "closing-60": only students who haven't voted, 1 hour before closing.
 *  - "closing-15": only students who haven't voted, 15 minutes before closing.
 *  - "reminder":   only students who haven't voted, sent by the committee.
 *  - "results":    everyone on the voter list, when results are published.
 * Who voted is already recorded (never what they voted), so the secret ballot is kept.
 */
export type NoticeKind = 'opened' | 'closing-60' | 'closing-15' | 'reminder' | 'results';
export type NoticeAudience = 'canVote' | 'notVoted' | 'everyone';

export interface Notice {
  /** Unique per election: a notice with the same key is never sent twice. */
  key: string;
  kind: NoticeKind;
  audience: NoticeAudience;
  /** Also email students who have no push notifications (only for "opened"). */
  email: boolean;
}

export interface NoticeElection {
  id: string;
  title: string;
  isTest: boolean;
  status: ElectionStatus;
  opensAt: Date;
  closesAt: Date;
  openedAt: Date | null;
  publishedAt: Date | null;
}

export interface NoticeMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const MINUTE = 60_000;
/** The committee can send a reminder at most once every 30 minutes. */
export const REMINDER_SPACING_MS = 30 * MINUTE;
/** Results notices are only sent for results published recently (not for old elections after a deploy). */
const RESULTS_WINDOW_MS = 6 * 60 * MINUTE;

const AUDIENCE: Record<NoticeKind, NoticeAudience> = {
  opened: 'canVote',
  'closing-60': 'notVoted',
  'closing-15': 'notVoted',
  reminder: 'notVoted',
  results: 'everyone',
};

function notice(kind: NoticeKind, key: string = kind): Notice {
  return { key, kind, audience: AUDIENCE[kind], email: kind === 'opened' };
}

/**
 * The automatic notices due right now. Test elections never notify anyone (the rehearsal
 * uses the whole class list, so a ping would reach everyone).
 *  - Closing reminders are skipped when voting opened too close to them, so nobody gets
 *    "voting is open" and "1 hour left" a minute apart; and when a reminder is due, a
 *    missed "voting is open" is not sent on top of it.
 *  - Their keys include the closing time, so after an extension they fire again at the new time.
 *  - Each one has a window (60 → 15 minutes, 15 → 1 minute): after a restart a missed
 *    reminder is dropped rather than sent late.
 */
export function dueNotices(election: NoticeElection, now: Date): Notice[] {
  if (election.isTest) return [];
  const status = effectiveStatus(election, now);
  const remaining = election.closesAt.getTime() - now.getTime();
  const openFor = election.closesAt.getTime() - (election.openedAt ?? election.opensAt).getTime();
  const closing = election.closesAt.toISOString();
  const due: Notice[] = [];
  if (status === 'open') {
    const closingSoon =
      remaining <= 60 * MINUTE && remaining > 15 * MINUTE && openFor >= 75 * MINUTE ? notice('closing-60', `closing-60@${closing}`)
        : remaining <= 15 * MINUTE && remaining > MINUTE && openFor >= 30 * MINUTE ? notice('closing-15', `closing-15@${closing}`)
          : null;
    // If "voting is open" was never sent (e.g. the server was down) and a closing reminder is due, send only the reminder.
    if (closingSoon) due.push(closingSoon);
    else if (remaining > 10 * MINUTE) due.push(notice('opened'));
  }
  if (status === 'published' && election.publishedAt && now.getTime() - election.publishedAt.getTime() < RESULTS_WINDOW_MS) {
    due.push(notice('results'));
  }
  return due;
}

/** A committee reminder; the key is the 30-minute slot, so two members pressing at once send one. */
export function reminderNotice(now: Date): Notice {
  return notice('reminder', `reminder@${Math.floor(now.getTime() / REMINDER_SPACING_MS)}`);
}

export function lagosTime(date: Date): string {
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

export function noticeMessage(kind: NoticeKind, election: Pick<NoticeElection, 'id' | 'title' | 'closesAt'>): NoticeMessage {
  const closes = lagosTime(election.closesAt);
  const url = `/student/elections/${election.id}`;
  const tag = `election-${election.id}-${kind}`;
  switch (kind) {
    case 'opened':
      return { title: 'Voting is open', body: `${election.title}: vote before ${closes}. It takes about a minute.`, url, tag };
    case 'closing-60':
      return { title: '1 hour left to vote', body: `You haven't voted in ${election.title} yet. Voting closes at ${closes}.`, url, tag };
    case 'closing-15':
      return { title: '15 minutes left to vote', body: `Last call: ${election.title} closes at ${closes}. Your vote counts.`, url, tag };
    case 'reminder':
      return { title: "You haven't voted yet", body: `${election.title} closes at ${closes}. Tap to vote now.`, url, tag };
    case 'results':
      return { title: 'Results are out', body: `${election.title}: see who won.`, url, tag };
  }
}
