import { createHash } from 'node:crypto';
import { AppError, badRequest, notFound } from '../../../shared/errors/AppError';
import {
  effectiveStatus,
  isUnopposed,
  RECEIPT_PATTERN,
  REQUEST_ID_PATTERN,
  tally,
  validateBallot,
} from '../domain/electionRules';
import { electionRepository, type ElectionRepository, type ElectionWithSetup } from '../infrastructure/electionRepository';
import { announceVote } from './electionBroadcast';

export interface StudentRef {
  id: string;
  matricNumber: string;
}

export function receiptHash(electionId: string, receiptCode: string): string {
  return createHash('sha256').update(`${electionId}:${receiptCode.toUpperCase()}`).digest('hex');
}

const STATUS_MESSAGES: Record<string, string> = {
  ready: 'Voting has not opened yet.',
  paused: 'Voting is paused by the electoral committee. Please wait; your ballot is still on this page.',
  closed: 'Voting has closed.',
  published: 'Voting has closed and the results are out.',
  draft: 'This election is not open.',
};

export class StudentElectionService {
  constructor(
    private readonly repo: ElectionRepository = electionRepository,
    private readonly onVote: (studentId: string, electionId: string, votedAt: Date) => void = announceVote,
  ) {}

  private async eligibility(election: ElectionWithSetup, studentId: string) {
    const student = await this.repo.findStudent(studentId);
    if (!student) throw new AppError(401, 'Please sign in again.');
    const blocked = student.suspendedAt
      ? 'Your account is suspended. Contact the electoral committee.'
      : election.registrationDeadline && student.createdAt.getTime() > election.registrationDeadline.getTime()
        ? `Registration for this election closed on ${election.registrationDeadline.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })}. Your account was created after that.`
        : null;
    return { student, blocked };
  }

  private async summary(election: ElectionWithSetup, studentId: string, votedAt: Date | null) {
    const status = effectiveStatus(election);
    const turnout = await this.repo.turnout(election.id);
    const { blocked } = await this.eligibility(election, studentId);
    return {
      id: election.id,
      title: election.title,
      description: election.description,
      isTest: election.isTest,
      status,
      opensAt: election.opensAt,
      closesAt: election.closesAt,
      publishedAt: election.publishedAt,
      serverTime: new Date(),
      turnout,
      me: { hasVoted: !!votedAt, votedAt, blockedReason: blocked },
      positions: election.positions.map((position) => ({
        id: position.id,
        title: position.title,
        unopposed: isUnopposed(position),
        candidates: position.candidates.map((candidate) => ({
          id: candidate.id,
          displayName: candidate.displayName,
          nickname: candidate.nickname,
          photoUrl: candidate.photoUrl,
          manifesto: candidate.manifesto,
        })),
      })),
    };
  }

  async list(student: StudentRef) {
    const elections = await this.repo.electionsForMatric(student.matricNumber);
    const voted = await this.repo.votedElectionIds(student.id);
    return Promise.all(elections.map((election) => this.summary(election, student.id, voted.get(election.id) ?? null)));
  }

  private async loadForStudent(student: StudentRef, id: string): Promise<ElectionWithSetup> {
    const election = await this.repo.find(id);
    // Students only ever see elections they are on the voter list for.
    if (!election || election.status === 'draft' || !(await this.repo.isOnRoll(id, student.matricNumber))) throw notFound('Election not found.');
    return election;
  }

  async detail(student: StudentRef, id: string) {
    const election = await this.loadForStudent(student, id);
    const record = await this.repo.voteRecordFor(id, student.id);
    return this.summary(election, student.id, record?.votedAt ?? null);
  }

  async vote(student: StudentRef, id: string, body: Record<string, unknown>) {
    const election = await this.loadForStudent(student, id);
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const receiptCode = typeof body.receiptCode === 'string' ? body.receiptCode.toUpperCase() : '';
    if (!REQUEST_ID_PATTERN.test(requestId) || !RECEIPT_PATTERN.test(receiptCode)) throw badRequest('Your ballot could not be read. Please refresh the page and try again.');

    const { student: account, blocked } = await this.eligibility(election, student.id);
    if (blocked) throw new AppError(403, blocked);

    // A repeat of the same submission is a success; any other second ballot is refused first.
    const record = await this.repo.voteRecordFor(id, student.id);
    if (record?.requestId === requestId) return { recorded: true, repeated: true, votedAt: record.votedAt };
    if (record) {
      const at = record.votedAt.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', timeStyle: 'short', dateStyle: 'medium' });
      throw new AppError(409, `You have already voted (${at}). A vote can't be changed.`);
    }
    const status = effectiveStatus(election);
    if (status !== 'open') throw new AppError(409, STATUS_MESSAGES[status] ?? 'Voting is not open.');

    const checked = validateBallot(election.positions, body.choices);
    if ('error' in checked) throw badRequest(checked.error);

    const result = await this.repo.castVote({
      electionId: id,
      studentId: account.id,
      matricNumber: account.matricNumber,
      requestId,
      receiptHash: receiptHash(id, receiptCode),
      choices: checked.choices,
    });
    if (!result.ok) {
      if (result.reason === 'already-voted') {
        const at = result.votedAt?.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', timeStyle: 'short', dateStyle: 'medium' });
        throw new AppError(409, `You have already voted${at ? ` (${at})` : ''}. A vote can't be changed.`);
      }
      if (result.reason === 'receipt-taken') throw new AppError(409, 'Please press Submit again.');
      throw new AppError(409, STATUS_MESSAGES[result.status ?? 'closed'] ?? 'Voting is not open.');
    }
    if (!result.repeated) this.onVote(account.id, id, result.votedAt);
    return { recorded: true, repeated: result.repeated, votedAt: result.votedAt };
  }

  async results(student: StudentRef, id: string) {
    const election = await this.loadForStudent(student, id);
    if (election.status !== 'published') throw new AppError(409, 'Results are not out yet.');
    const [choices, turnout] = await Promise.all([this.repo.allChoices(id), this.repo.turnout(id)]);
    return {
      electionId: id,
      title: election.title,
      publishedAt: election.publishedAt,
      positions: tally(election.positions, choices),
      turnout: { ...turnout, percent: turnout.eligible ? Math.round((turnout.voted / turnout.eligible) * 1000) / 10 : 0 },
    };
  }

  /** Confirms a receipt was counted. It never reveals the choices on it (no proof of vote for sale). */
  async checkReceipt(student: StudentRef, id: string, body: Record<string, unknown>) {
    const election = await this.loadForStudent(student, id);
    const status = effectiveStatus(election);
    if (status !== 'closed' && status !== 'published') throw new AppError(409, 'You can check a receipt once voting closes.');
    const code = typeof body.receiptCode === 'string' ? body.receiptCode.trim().toUpperCase().replace(/[\s-]/g, '') : '';
    if (!RECEIPT_PATTERN.test(code)) throw badRequest('A receipt code has 10 letters and numbers.');
    return { counted: await this.repo.receiptExists(id, receiptHash(id, code)) };
  }
}

export const studentElectionService = new StudentElectionService();
