/**
 * Pure election rules: status over time, who may do what, ballot validation and counting.
 * No database or framework code here, so every rule is unit-tested directly.
 */

export type ElectionStatus = 'draft' | 'ready' | 'open' | 'paused' | 'closed' | 'published';

export const MAX_POSITIONS = 20;
export const MAX_CANDIDATES_PER_POSITION = 15;
export const MAX_TITLE_LENGTH = 120;
export const MAX_MANIFESTO_LENGTH = 1500;
/** If one committee member is unreachable, the other may publish alone this long after closing. */
export const SOLO_PUBLISH_DELAY_MS = 30 * 60_000;
export const RECEIPT_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;
export const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ElectionTiming {
  status: ElectionStatus;
  opensAt: Date;
  closesAt: Date;
}

/**
 * What the election really is right now. Opening and closing follow the clock even if
 * the background scheduler has not caught up yet, so a vote one second after closing
 * is refused no matter what the stored status says.
 */
export function effectiveStatus(election: ElectionTiming, now: Date = new Date()): ElectionStatus {
  const { status } = election;
  if (status === 'draft' || status === 'closed' || status === 'published') return status;
  if (now.getTime() >= election.closesAt.getTime()) return 'closed';
  if (status === 'ready') return now.getTime() >= election.opensAt.getTime() ? 'open' : 'ready';
  return status; // open | paused
}

export function isVotingOpen(election: ElectionTiming, now: Date = new Date()): boolean {
  return effectiveStatus(election, now) === 'open';
}

/** The setup (positions, candidates, voter list) can only change while in draft. */
export function isSetupEditable(status: ElectionStatus): boolean {
  return status === 'draft';
}

/** Typos in a candidate's name, photo or manifesto can be fixed until results are published. */
export function isCandidateProfileEditable(status: ElectionStatus): boolean {
  return status !== 'published';
}

export type StaffRole = 'cr' | 'acr' | 'fin_sec' | 'dev' | 'electoral_committee';
export type ElectionAction =
  | 'view'
  | 'setup'
  | 'manageCommittee'
  | 'run'
  | 'previewResults'
  | 'moderateVoters'
  /** Fix a candidate's name, nickname, photo or manifesto (both the developer and the committee). */
  | 'editCandidate';

/**
 * Separation of duties: the developer sets the election up, the electoral committee runs
 * it. Class reps have no access. Nobody can see individual votes; that is enforced by
 * the data model, not by a permission.
 */
export function canPerform(role: StaffRole | string | undefined, action: ElectionAction): boolean {
  if (role === 'dev') return action === 'view' || action === 'setup' || action === 'manageCommittee' || action === 'editCandidate';
  if (role === 'electoral_committee') return action !== 'setup' && action !== 'manageCommittee';
  return false;
}

export function validateSchedule(opensAt: Date, closesAt: Date, registrationDeadline?: Date | null): string | null {
  if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) return 'Choose an opening and a closing time.';
  if (closesAt.getTime() <= opensAt.getTime()) return 'Voting must close after it opens.';
  if (closesAt.getTime() - opensAt.getTime() < 5 * 60_000) return 'Voting must stay open for at least 5 minutes.';
  if (closesAt.getTime() - opensAt.getTime() > 14 * 24 * 60 * 60_000) return 'Voting cannot stay open for more than 14 days.';
  if (registrationDeadline && Number.isNaN(registrationDeadline.getTime())) return 'The registration deadline is not a valid time.';
  if (registrationDeadline && registrationDeadline.getTime() > closesAt.getTime()) return 'The registration deadline must be before voting closes.';
  return null;
}

export interface BallotPosition {
  id: string;
  title: string;
  candidates: Array<{ id: string }>;
}

export interface BallotChoiceInput {
  positionId: string;
  candidateId: string;
  approve?: boolean | null;
}

export interface ValidChoice {
  positionId: string;
  candidateId: string;
  approve: boolean | null;
}

/** An unopposed candidate gets a Yes/No vote instead of a pick. */
export function isUnopposed(position: BallotPosition): boolean {
  return position.candidates.length === 1;
}

/**
 * Every position must be answered exactly once (no skipping), with a candidate that
 * belongs to that position. Unopposed positions need a Yes or a No.
 */
export function validateBallot(positions: BallotPosition[], rawChoices: unknown): { choices: ValidChoice[] } | { error: string } {
  if (!Array.isArray(rawChoices)) return { error: 'Your ballot is empty.' };
  const byPosition = new Map<string, ValidChoice>();
  for (const raw of rawChoices) {
    if (!raw || typeof raw !== 'object') return { error: 'Your ballot could not be read. Please refresh and try again.' };
    const { positionId, candidateId, approve } = raw as Record<string, unknown>;
    if (typeof positionId !== 'string' || typeof candidateId !== 'string') return { error: 'Your ballot could not be read. Please refresh and try again.' };
    const position = positions.find((item) => item.id === positionId);
    if (!position) return { error: 'Your ballot has a position that is not in this election. Please refresh and try again.' };
    if (byPosition.has(positionId)) return { error: `You picked twice for ${position.title}.` };
    if (!position.candidates.some((candidate) => candidate.id === candidateId)) {
      return { error: `Your choice for ${position.title} is not a candidate for that position. Please refresh and try again.` };
    }
    if (isUnopposed(position)) {
      if (typeof approve !== 'boolean') return { error: `Choose Yes or No for ${position.title}.` };
      byPosition.set(positionId, { positionId, candidateId, approve });
    } else {
      byPosition.set(positionId, { positionId, candidateId, approve: null });
    }
  }
  const missing = positions.filter((position) => !byPosition.has(position.id));
  if (missing.length) return { error: `Choose a candidate for ${missing.map((position) => position.title).join(', ')}.` };
  return { choices: positions.map((position) => byPosition.get(position.id)!) };
}

export interface TallyPosition {
  id: string;
  title: string;
  candidates: Array<{ id: string; displayName: string; nickname: string | null; photoUrl: string | null }>;
}

export interface CandidateResult {
  candidateId: string;
  displayName: string;
  nickname: string | null;
  photoUrl: string | null;
  votes: number;
  percent: number;
  rank: number;
  isWinner: boolean;
}

export interface PositionResult {
  positionId: string;
  title: string;
  totalVotes: number;
  unopposed: boolean;
  /** Unopposed: yes/no counts. */
  yes?: number;
  no?: number;
  tie: boolean;
  candidates: CandidateResult[];
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

/**
 * Counts per position, ranked from most votes to least. Ties are flagged, never broken:
 * they are settled outside the app. An unopposed candidate wins with more Yes than No.
 */
export function tally(positions: TallyPosition[], choices: Array<{ positionId: string; candidateId: string; approve: boolean | null }>): PositionResult[] {
  return positions.map((position) => {
    const mine = choices.filter((choice) => choice.positionId === position.id);
    const total = mine.length;
    if (position.candidates.length === 1) {
      const candidate = position.candidates[0];
      const yes = mine.filter((choice) => choice.approve === true).length;
      const no = mine.filter((choice) => choice.approve === false).length;
      return {
        positionId: position.id,
        title: position.title,
        totalVotes: total,
        unopposed: true,
        yes,
        no,
        tie: yes === no && total > 0,
        candidates: [{ candidateId: candidate.id, displayName: candidate.displayName, nickname: candidate.nickname, photoUrl: candidate.photoUrl,
          votes: yes, percent: percent(yes, total), rank: 1, isWinner: yes > no }],
      };
    }
    const counts = position.candidates.map((candidate) => ({
      candidate,
      votes: mine.filter((choice) => choice.candidateId === candidate.id).length,
    }));
    counts.sort((a, b) => b.votes - a.votes || a.candidate.displayName.localeCompare(b.candidate.displayName));
    const top = counts[0]?.votes ?? 0;
    const leaders = counts.filter((entry) => entry.votes === top).length;
    const tie = total > 0 && leaders > 1;
    let rank = 0;
    let previous = -1;
    const candidates = counts.map((entry, index) => {
      if (entry.votes !== previous) { rank = index + 1; previous = entry.votes; }
      return {
        candidateId: entry.candidate.id,
        displayName: entry.candidate.displayName,
        nickname: entry.candidate.nickname,
        photoUrl: entry.candidate.photoUrl,
        votes: entry.votes,
        percent: percent(entry.votes, total),
        rank,
        isWinner: total > 0 && !tie && entry.votes === top,
      };
    });
    return { positionId: position.id, title: position.title, totalVotes: total, unopposed: false, tie, candidates };
  });
}

/**
 * Publishing needs both committee members. If only one has approved, they may publish
 * alone once 30 minutes have passed since voting closed (the other may be unreachable).
 */
export function publishDecision(approvals: number, closedAt: Date | null, now: Date = new Date()): 'publish' | 'wait-for-second' | 'blocked' {
  if (approvals >= 2) return 'publish';
  if (approvals === 1 && closedAt && now.getTime() - closedAt.getTime() >= SOLO_PUBLISH_DELAY_MS) return 'publish';
  if (approvals === 1) return 'wait-for-second';
  return 'blocked';
}

/** Ballots are stored with the hour only, so their time can't be matched to a voter. */
export function castHour(now: Date = new Date()): Date {
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

export function normalizeMatric(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') : '';
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${shown}${'*'.repeat(Math.max(1, Math.min(6, local.length - shown.length)))}@${domain}`;
}
