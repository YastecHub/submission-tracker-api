import { AppError, badRequest, forbidden, notFound } from '../../../shared/errors/AppError';
import { uploadImageBuffer } from '../../../lib/cloudinary';
import { forgetStudentSession } from '../../studentAuth/application/studentSessions';
import {
  canPerform,
  effectiveStatus,
  isCandidateProfileEditable,
  isSetupEditable,
  MAX_CANDIDATES_PER_POSITION,
  MAX_MANIFESTO_LENGTH,
  MAX_POSITIONS,
  MAX_TITLE_LENGTH,
  maskEmail,
  normalizeMatric,
  publishDecision,
  SOLO_PUBLISH_DELAY_MS,
  tally,
  validateSchedule,
  type ElectionAction,
  type ElectionStatus,
} from '../domain/electionRules';
import { lagosTime, REMINDER_SPACING_MS, reminderNotice } from '../domain/electionNotices';
import { readVoterList, type VoterRow } from '../domain/voterList';
import { loadClassList } from '../infrastructure/classList';
import { electionRepository, type Actor, type ElectionRepository, type ElectionWithSetup } from '../infrastructure/electionRepository';
import { announceElection } from './electionBroadcast';
import { electionNotifier, type ElectionNotifier } from './electionNotifier';

export interface StaffUser {
  id: string;
  name: string;
  role: string;
}

export interface PhotoFile {
  buffer: Buffer;
}

type PhotoUploader = (file: PhotoFile) => Promise<{ url: string; publicId: string }>;

const defaultUploader: PhotoUploader = (file) => uploadImageBuffer(file.buffer, 'nexium-elections');

function text(value: unknown, field: string, { max, required }: { max: number; required: boolean }): string | null {
  const trimmed = typeof value === 'string' ? value.trim().replace(/[ \t]+/g, ' ') : '';
  if (!trimmed) {
    if (required) throw badRequest(`${field} is required.`);
    return null;
  }
  if (trimmed.length > max) throw badRequest(`${field} is too long (${max} characters max).`);
  return trimmed;
}

function date(value: unknown, field: string, required: boolean): Date | null {
  if (value === null || value === undefined || value === '') {
    if (required) throw badRequest(`${field} is required.`);
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw badRequest(`${field} is not a valid date and time.`);
  return parsed;
}

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

export class ElectionAdminService {
  constructor(
    private readonly repo: ElectionRepository = electionRepository,
    private readonly uploadPhoto: PhotoUploader = defaultUploader,
    private readonly announce: (electionId: string) => void = announceElection,
    private readonly classList: () => VoterRow[] = loadClassList,
    private readonly notifier: Pick<ElectionNotifier, 'send' | 'history' | 'lastReminderAt'> = electionNotifier,
  ) {}

  private require(user: StaffUser, action: ElectionAction) {
    if (!canPerform(user.role, action)) {
      throw forbidden(action === 'setup' || action === 'manageCommittee'
        ? 'Only the developer sets up elections.'
        : 'Only the electoral committee can do this.');
    }
  }

  private actor(user: StaffUser): Actor {
    return { id: user.id, name: user.name, role: user.role };
  }

  private async load(id: string): Promise<ElectionWithSetup> {
    const election = await this.repo.find(id);
    if (!election) throw notFound('Election not found.');
    return election;
  }

  /** Persists a clock-driven change (auto open/close) before acting on it. */
  private async settle(election: ElectionWithSetup): Promise<ElectionStatus> {
    const actual = effectiveStatus(election);
    if (actual !== election.status) {
      const at = actual === 'closed' ? election.closesAt : election.opensAt;
      const changed = await this.repo.updateIf(election.id, [election.status], actual === 'closed' ? { status: 'closed', closedAt: at } : { status: 'open', openedAt: at });
      if (changed) {
        await this.repo.audit(election.id, { id: null, name: 'NEXIUM', role: 'system' }, actual === 'closed' ? 'auto-closed' : 'auto-opened');
        this.announce(election.id);
      }
    }
    return actual;
  }

  async list(user: StaffUser) {
    this.require(user, 'view');
    const elections = await this.repo.list();
    return elections.map((election) => ({
      id: election.id,
      title: election.title,
      isTest: election.isTest,
      status: election.status,
      effectiveStatus: effectiveStatus(election),
      opensAt: election.opensAt,
      closesAt: election.closesAt,
      publishedAt: election.publishedAt,
      counts: { positions: election._count.positions, candidates: election._count.candidates, voters: election._count.voterRoll, voted: election._count.voteRecords },
    }));
  }

  async detail(user: StaffUser, id: string) {
    this.require(user, 'view');
    const election = await this.load(id);
    const status = await this.settle(election);
    const [turnout, registered, ballots, approvals, committee, notifications] = await Promise.all([
      this.repo.turnout(id),
      this.repo.registeredCount(id),
      this.repo.ballotCount(id),
      this.repo.approvals(id),
      this.repo.committeeMembers(),
      this.notifier.history(id),
    ]);
    const lastReminder = notifications.find((notice) => notice.kind === 'reminder');
    const closedAt = election.closedAt ?? (status === 'closed' ? election.closesAt : null);
    return {
      id: election.id,
      title: election.title,
      description: election.description,
      isTest: election.isTest,
      status,
      opensAt: election.opensAt,
      closesAt: election.closesAt,
      registrationDeadline: election.registrationDeadline,
      openedAt: election.openedAt,
      closedAt,
      publishedAt: election.publishedAt,
      version: election.version,
      positions: election.positions.map((position) => ({
        id: position.id,
        title: position.title,
        sortOrder: position.sortOrder,
        candidates: position.candidates.map((candidate) => ({
          id: candidate.id,
          matricNumber: candidate.matricNumber,
          displayName: candidate.displayName,
          nickname: candidate.nickname,
          photoUrl: candidate.photoUrl,
          manifesto: candidate.manifesto,
          sortOrder: candidate.sortOrder,
        })),
      })),
      counts: { voters: turnout.eligible, registered, voted: turnout.voted, ballots },
      approvals: approvals.map((approval) => ({ userId: approval.userId, name: approval.user.name, at: approval.createdAt })),
      soloPublishAt: closedAt ? new Date(closedAt.getTime() + SOLO_PUBLISH_DELAY_MS) : null,
      committee: committee.map((member) => ({ id: member.id, name: member.name })),
      notifications: notifications.map((notice) => ({ kind: notice.kind, at: notice.createdAt, sentBy: notice.sentByName, pushQueued: notice.pushQueued, emailsSent: notice.emailsSent })),
      reminderAvailableAt: lastReminder ? new Date(lastReminder.createdAt.getTime() + REMINDER_SPACING_MS) : null,
    };
  }

  /** Committee: push "you haven't voted yet" to students who haven't voted (at most every 30 minutes). */
  async remind(user: StaffUser, id: string) {
    this.require(user, 'run');
    const election = await this.load(id);
    if (election.isTest) throw new AppError(409, "Test elections don't send notifications, so the whole class isn't pinged during a rehearsal.");
    if (effectiveStatus(election) !== 'open') throw new AppError(409, 'Reminders can only be sent while voting is open.');
    const now = new Date();
    const last = await this.notifier.lastReminderAt(id);
    if (last && now.getTime() - last.getTime() < REMINDER_SPACING_MS) {
      throw new AppError(409, `A reminder went out at ${lagosTime(last)}. The next one can go at ${lagosTime(new Date(last.getTime() + REMINDER_SPACING_MS))}.`);
    }
    const result = await this.notifier.send(election, reminderNotice(now), user.name);
    if (!result) throw new AppError(409, 'The other committee member has just sent a reminder.');
    await this.repo.audit(id, this.actor(user), 'reminder-sent', { phones: result.pushQueued });
    return this.detail(user, id);
  }

  // ---- Setup (developer) ---------------------------------------------------

  private schedule(body: Record<string, unknown>, current?: { opensAt: Date; closesAt: Date; registrationDeadline: Date | null }) {
    const opensAt = body.opensAt !== undefined ? date(body.opensAt, 'Opening time', true)! : current!.opensAt;
    const closesAt = body.closesAt !== undefined ? date(body.closesAt, 'Closing time', true)! : current!.closesAt;
    const registrationDeadline = body.registrationDeadline !== undefined ? date(body.registrationDeadline, 'Registration deadline', false) : current?.registrationDeadline ?? null;
    const problem = validateSchedule(opensAt, closesAt, registrationDeadline);
    if (problem) throw badRequest(problem);
    return { opensAt, closesAt, registrationDeadline };
  }

  async create(user: StaffUser, body: Record<string, unknown>) {
    this.require(user, 'setup');
    const title = text(body.title, 'Title', { max: MAX_TITLE_LENGTH, required: true })!;
    const description = text(body.description, 'Description', { max: 1000, required: false });
    const schedule = this.schedule(body);
    const election = await this.repo.create({ title, description, ...schedule, isTest: flag(body.isTest), createdById: user.id });
    await this.repo.audit(election.id, this.actor(user), 'created', { title, isTest: election.isTest });
    // Every election's voter list starts as the whole class list (prisma/data/class-list.csv).
    const voters = this.classList();
    if (voters.length) {
      await this.repo.addVoters(election.id, voters);
      await this.repo.audit(election.id, this.actor(user), 'voters-from-class-list', { total: voters.length });
    }
    return this.detail(user, election.id);
  }

  async update(user: StaffUser, id: string, body: Record<string, unknown>) {
    this.require(user, 'setup');
    const election = await this.load(id);
    if (!isSetupEditable(election.status)) throw new AppError(409, 'The election is locked. Move it back to setup first (only possible before voting opens).');
    const title = body.title !== undefined ? text(body.title, 'Title', { max: MAX_TITLE_LENGTH, required: true })! : election.title;
    const description = body.description !== undefined ? text(body.description, 'Description', { max: 1000, required: false }) : election.description;
    const schedule = this.schedule(body, election);
    const isTest = body.isTest !== undefined ? flag(body.isTest) : election.isTest;
    if (!(await this.repo.updateIf(id, ['draft'], { title, description, ...schedule, isTest }))) throw new AppError(409, 'The election changed. Refresh and try again.');
    await this.repo.audit(id, this.actor(user), 'updated', { title, opensAt: schedule.opensAt.toISOString(), closesAt: schedule.closesAt.toISOString() });
    this.announce(id);
    return this.detail(user, id);
  }

  async remove(user: StaffUser, id: string) {
    this.require(user, 'setup');
    const election = await this.load(id);
    const { voted } = await this.repo.turnout(id);
    if (!election.isTest && voted > 0) throw new AppError(409, 'This election has votes and cannot be deleted. Only test elections can.');
    if (!election.isTest && ['open', 'paused'].includes(effectiveStatus(election))) throw new AppError(409, 'Voting is in progress.');
    await this.repo.delete(id);
    this.announce(id);
    return { deleted: true };
  }

  async addPosition(user: StaffUser, id: string, body: Record<string, unknown>) {
    this.require(user, 'setup');
    const election = await this.load(id);
    if (!isSetupEditable(election.status)) throw new AppError(409, 'Positions are locked once the election is ready.');
    if (election.positions.length >= MAX_POSITIONS) throw badRequest(`An election can have at most ${MAX_POSITIONS} positions.`);
    const title = text(body.title, 'Position title', { max: MAX_TITLE_LENGTH, required: true })!;
    if (election.positions.some((position) => position.title.toLowerCase() === title.toLowerCase())) throw badRequest(`${title} is already a position.`);
    const sortOrder = election.positions.reduce((max, position) => Math.max(max, position.sortOrder), -1) + 1;
    await this.repo.createPosition(id, title, sortOrder);
    await this.repo.audit(id, this.actor(user), 'position-added', { title });
    return this.detail(user, id);
  }

  async updatePosition(user: StaffUser, id: string, positionId: string, body: Record<string, unknown>) {
    this.require(user, 'setup');
    const election = await this.load(id);
    if (!isSetupEditable(election.status)) throw new AppError(409, 'Positions are locked once the election is ready.');
    const position = election.positions.find((item) => item.id === positionId);
    if (!position) throw notFound('Position not found.');
    const data: { title?: string; sortOrder?: number } = {};
    if (body.title !== undefined) data.title = text(body.title, 'Position title', { max: MAX_TITLE_LENGTH, required: true })!;
    if (body.move === 'up' || body.move === 'down') {
      const ordered = [...election.positions].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = ordered.findIndex((item) => item.id === positionId);
      const target = body.move === 'up' ? index - 1 : index + 1;
      if (target >= 0 && target < ordered.length) {
        [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        for (const [order, item] of ordered.entries()) {
          if (item.id !== positionId && item.sortOrder !== order) await this.repo.updatePosition(item.id, { sortOrder: order });
        }
        data.sortOrder = target;
      }
    }
    await this.repo.updatePosition(positionId, data);
    if (data.title) await this.repo.audit(id, this.actor(user), 'position-renamed', { from: position.title, to: data.title });
    return this.detail(user, id);
  }

  async removePosition(user: StaffUser, id: string, positionId: string) {
    this.require(user, 'setup');
    const election = await this.load(id);
    if (!isSetupEditable(election.status)) throw new AppError(409, 'Positions are locked once the election is ready.');
    const position = election.positions.find((item) => item.id === positionId);
    if (!position) throw notFound('Position not found.');
    await this.repo.deletePosition(positionId);
    await this.repo.audit(id, this.actor(user), 'position-removed', { title: position.title });
    return this.detail(user, id);
  }

  async addCandidate(user: StaffUser, id: string, body: Record<string, unknown>, photo?: PhotoFile) {
    this.require(user, 'setup');
    const election = await this.load(id);
    if (!isSetupEditable(election.status)) throw new AppError(409, 'Candidates are locked once the election is ready. You can still fix a name, photo or manifesto.');
    const position = election.positions.find((item) => item.id === body.positionId);
    if (!position) throw badRequest('Choose the position this candidate is running for.');
    if (position.candidates.length >= MAX_CANDIDATES_PER_POSITION) throw badRequest(`A position can have at most ${MAX_CANDIDATES_PER_POSITION} candidates.`);
    const displayName = text(body.displayName, 'Candidate name', { max: 120, required: true })!;
    const matricNumber = normalizeMatric(body.matricNumber) || null;
    if (matricNumber && election.positions.some((item) => item.candidates.some((candidate) => candidate.matricNumber === matricNumber))) {
      throw badRequest(`${matricNumber} is already a candidate in this election.`);
    }
    const uploaded = photo ? await this.uploadPhoto(photo) : null;
    await this.repo.createCandidate({
      electionId: id,
      positionId: position.id,
      displayName,
      matricNumber,
      nickname: text(body.nickname, 'Nickname', { max: 60, required: false }),
      manifesto: text(body.manifesto, 'Manifesto', { max: MAX_MANIFESTO_LENGTH, required: false }),
      photoUrl: uploaded?.url ?? null,
      photoPublicId: uploaded?.publicId ?? null,
      sortOrder: position.candidates.length,
    });
    await this.repo.audit(id, this.actor(user), 'candidate-added', { position: position.title, name: displayName });
    return this.detail(user, id);
  }

  /** Name, nickname, photo and manifesto can be corrected until results are published (logged). */
  async updateCandidate(user: StaffUser, id: string, candidateId: string, body: Record<string, unknown>, photo?: PhotoFile) {
    this.require(user, 'editCandidate');
    const election = await this.load(id);
    if (!isCandidateProfileEditable(election.status)) throw new AppError(409, 'Results are published; candidates can no longer change.');
    const candidate = await this.repo.findCandidate(id, candidateId);
    if (!candidate) throw notFound('Candidate not found.');
    const data: Record<string, unknown> = {};
    if (body.displayName !== undefined) data.displayName = text(body.displayName, 'Candidate name', { max: 120, required: true });
    if (body.nickname !== undefined) data.nickname = text(body.nickname, 'Nickname', { max: 60, required: false });
    if (body.manifesto !== undefined) data.manifesto = text(body.manifesto, 'Manifesto', { max: MAX_MANIFESTO_LENGTH, required: false });
    const movesCandidate = body.matricNumber !== undefined || (body.positionId !== undefined && body.positionId !== candidate.positionId);
    if (movesCandidate && !canPerform(user.role, 'setup')) throw forbidden('Only the developer can change a candidate\'s matric number or position.');
    if (body.matricNumber !== undefined) {
      if (!isSetupEditable(election.status)) throw new AppError(409, 'The matric number is locked once the election is ready.');
      data.matricNumber = normalizeMatric(body.matricNumber) || null;
    }
    if (body.positionId !== undefined && body.positionId !== candidate.positionId) {
      if (!isSetupEditable(election.status)) throw new AppError(409, 'Candidates cannot move between positions once the election is ready.');
      if (!election.positions.some((position) => position.id === body.positionId)) throw badRequest('That position is not in this election.');
      data.positionId = body.positionId;
    }
    if (photo) {
      const uploaded = await this.uploadPhoto(photo);
      data.photoUrl = uploaded.url;
      data.photoPublicId = uploaded.publicId;
    } else if (flag(body.removePhoto)) {
      data.photoUrl = null;
      data.photoPublicId = null;
    }
    await this.repo.updateCandidate(candidateId, data);
    await this.repo.audit(id, this.actor(user), 'candidate-edited', { candidate: candidate.displayName, fields: Object.keys(data).filter((key) => key !== 'photoPublicId') });
    this.announce(id);
    return this.detail(user, id);
  }

  async removeCandidate(user: StaffUser, id: string, candidateId: string) {
    this.require(user, 'setup');
    const election = await this.load(id);
    if (!isSetupEditable(election.status)) throw new AppError(409, 'Candidates are locked once the election is ready.');
    const candidate = await this.repo.findCandidate(id, candidateId);
    if (!candidate) throw notFound('Candidate not found.');
    await this.repo.deleteCandidate(candidateId);
    await this.repo.audit(id, this.actor(user), 'candidate-removed', { name: candidate.displayName });
    return this.detail(user, id);
  }

  /** Dry run first: shows how many are new, already registered, etc. Replaces the list while in setup. */
  async uploadVoters(user: StaffUser, id: string, body: Record<string, unknown>) {
    this.require(user, 'setup');
    const election = await this.load(id);
    const dryRun = body.dryRun !== false;
    const mode = isSetupEditable(election.status) ? 'replace' : 'add';
    if (mode === 'add' && ['closed', 'published'].includes(effectiveStatus(election))) throw new AppError(409, 'Voting has closed; the voter list can no longer change.');
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw badRequest('Paste or upload the voter list.');
    if (body.csv.length > 400_000) throw badRequest('The file is too large.');
    const { rows, errors } = readVoterList(body.csv);
    const clashes = await this.repo.rosterEmailClashes(rows);
    for (const clash of clashes) errors.push(`${clash.email} is already the email for ${clash.matricNumber} on the student list.`);
    const current = await this.repo.rollMatrics(id);
    const preview = {
      mode,
      total: rows.length,
      emailOnly: rows.filter((row) => row.emailOnly).length,
      added: rows.filter((row) => !current.has(row.matricNumber)).length,
      removed: mode === 'replace' ? [...current].filter((matric) => !rows.some((row) => row.matricNumber === matric)).length : 0,
      errors: errors.slice(0, 50),
      errorCount: errors.length,
    };
    if (dryRun || errors.length) return { ...preview, applied: false };
    if (mode === 'replace') await this.repo.replaceVoterRoll(id, rows);
    else await this.repo.addVoters(id, rows);
    await this.repo.audit(id, this.actor(user), mode === 'replace' ? 'voters-replaced' : 'voters-added', { total: rows.length, added: preview.added, removed: preview.removed });
    this.announce(id);
    return { ...preview, applied: true };
  }

  /** Locks the setup and hands the election to the committee. */
  async markReady(user: StaffUser, id: string) {
    this.require(user, 'setup');
    const election = await this.load(id);
    if (election.status !== 'draft') throw new AppError(409, 'The election is already locked.');
    if (!election.positions.length) throw badRequest('Add at least one position.');
    const empty = election.positions.filter((position) => position.candidates.length === 0);
    if (empty.length) throw badRequest(`Add a candidate for ${empty.map((position) => position.title).join(', ')}.`);
    const { eligible } = await this.repo.turnout(id);
    if (!eligible) throw badRequest('The voter list is empty. Add the class to prisma/data/class-list.csv and redeploy.');
    if (election.closesAt.getTime() <= Date.now() + 5 * 60_000) throw badRequest('The closing time has passed or is too close. Change the times first.');
    if (!(await this.repo.updateIf(id, ['draft'], { status: 'ready' }))) throw new AppError(409, 'The election changed. Refresh and try again.');
    await this.repo.audit(id, this.actor(user), 'locked-ready');
    this.announce(id);
    return this.detail(user, id);
  }

  async backToDraft(user: StaffUser, id: string) {
    this.require(user, 'setup');
    const election = await this.load(id);
    if (effectiveStatus(election) !== 'ready') throw new AppError(409, 'Only an election that has not opened yet can go back to setup.');
    if (!(await this.repo.updateIf(id, ['ready'], { status: 'draft' }))) throw new AppError(409, 'The election changed. Refresh and try again.');
    await this.repo.audit(id, this.actor(user), 'unlocked-draft');
    this.announce(id);
    return this.detail(user, id);
  }

  // ---- Running (electoral committee) ----------------------------------------

  async open(user: StaffUser, id: string) {
    this.require(user, 'run');
    const election = await this.load(id);
    const status = await this.settle(election);
    if (status !== 'ready') throw new AppError(409, status === 'draft' ? 'The developer has not locked the election yet.' : 'Voting is already open or finished.');
    const now = new Date();
    if (!(await this.repo.updateIf(id, ['ready'], { status: 'open', openedAt: now, opensAt: now }))) throw new AppError(409, 'The election changed. Refresh and try again.');
    await this.repo.audit(id, this.actor(user), 'opened-early', { scheduledFor: election.opensAt.toISOString() });
    this.announce(id);
    return this.detail(user, id);
  }

  async pause(user: StaffUser, id: string) {
    this.require(user, 'run');
    const election = await this.load(id);
    if ((await this.settle(election)) !== 'open') throw new AppError(409, 'Voting is not open.');
    if (!(await this.repo.updateIf(id, ['open', 'ready'], { status: 'paused' }))) throw new AppError(409, 'The election changed. Refresh and try again.');
    await this.repo.audit(id, this.actor(user), 'paused');
    this.announce(id);
    return this.detail(user, id);
  }

  async resume(user: StaffUser, id: string) {
    this.require(user, 'run');
    const election = await this.load(id);
    if ((await this.settle(election)) !== 'paused') throw new AppError(409, 'Voting is not paused.');
    if (!(await this.repo.updateIf(id, ['paused'], { status: 'open' }))) throw new AppError(409, 'The election changed. Refresh and try again.');
    await this.repo.audit(id, this.actor(user), 'resumed');
    this.announce(id);
    return this.detail(user, id);
  }

  async extend(user: StaffUser, id: string, body: Record<string, unknown>) {
    this.require(user, 'run');
    const election = await this.load(id);
    const status = await this.settle(election);
    if (!['ready', 'open', 'paused'].includes(status)) throw new AppError(409, 'Voting has closed; the time can no longer be extended.');
    const closesAt = date(body.closesAt, 'New closing time', true)!;
    if (closesAt.getTime() <= election.closesAt.getTime()) throw badRequest('The new closing time must be later than the current one. It can never be shortened.');
    if (closesAt.getTime() - election.closesAt.getTime() > 24 * 60 * 60_000) throw badRequest('Extend by at most 24 hours at a time.');
    if (!(await this.repo.updateIf(id, ['ready', 'open', 'paused'], { closesAt }))) throw new AppError(409, 'The election changed. Refresh and try again.');
    await this.repo.audit(id, this.actor(user), 'extended', { from: election.closesAt.toISOString(), to: closesAt.toISOString() });
    this.announce(id);
    return this.detail(user, id);
  }

  async close(user: StaffUser, id: string) {
    this.require(user, 'run');
    const election = await this.load(id);
    const status = await this.settle(election);
    if (status !== 'open' && status !== 'paused') throw new AppError(409, 'Voting is not open.');
    const now = new Date();
    if (!(await this.repo.updateIf(id, ['open', 'paused', 'ready'], { status: 'closed', closedAt: now, closesAt: now }))) throw new AppError(409, 'The election changed. Refresh and try again.');
    await this.repo.audit(id, this.actor(user), 'closed-early', { scheduledFor: election.closesAt.toISOString() });
    this.announce(id);
    return this.detail(user, id);
  }

  /** Counts are only ever computed after voting closes. */
  async results(user: StaffUser, id: string) {
    this.require(user, 'view');
    const election = await this.load(id);
    const status = await this.settle(election);
    if (status !== 'closed' && status !== 'published') throw new AppError(409, 'Results are available once voting closes.');
    if (status === 'closed' && !canPerform(user.role, 'previewResults')) throw forbidden('Results are visible to you once the committee publishes them.');
    return this.buildResults(election);
  }

  private async buildResults(election: ElectionWithSetup) {
    const [choices, turnout, ballots] = await Promise.all([this.repo.allChoices(election.id), this.repo.turnout(election.id), this.repo.ballotCount(election.id)]);
    return {
      electionId: election.id,
      title: election.title,
      positions: tally(election.positions, choices),
      turnout: { voted: turnout.voted, eligible: turnout.eligible, ballots, percent: turnout.eligible ? Math.round((turnout.voted / turnout.eligible) * 1000) / 10 : 0 },
      integrity: { ok: ballots === turnout.voted, ballots, voters: turnout.voted },
    };
  }

  async approvePublish(user: StaffUser, id: string) {
    this.require(user, 'run');
    const election = await this.load(id);
    const status = await this.settle(election);
    if (status === 'published') throw new AppError(409, 'Results are already published.');
    if (status !== 'closed') throw new AppError(409, 'Results can be published only after voting closes.');
    const results = await this.buildResults(election);
    if (!results.integrity.ok) {
      throw new AppError(409, `Integrity check failed: ${results.integrity.ballots} ballots but ${results.integrity.voters} voters. Publishing is blocked; contact the developer.`);
    }
    await this.repo.addApproval(id, user.id);
    await this.repo.audit(id, this.actor(user), 'approved-publish');
    const approvals = await this.repo.approvals(id);
    const closedAt = election.closedAt ?? election.closesAt;
    const decision = publishDecision(approvals.length, closedAt);
    if (decision === 'publish') {
      if (await this.repo.updateIf(id, ['closed'], { status: 'published', publishedAt: new Date() })) {
        await this.repo.audit(id, this.actor(user), 'published', { approvals: approvals.map((approval) => approval.user.name) });
        this.announce(id);
      }
    }
    return { published: decision === 'publish', decision, detail: await this.detail(user, id) };
  }

  // ---- Voters and accounts ---------------------------------------------------

  async registrations(user: StaffUser, id: string) {
    this.require(user, 'view');
    await this.load(id);
    const rows = await this.repo.registrations(id);
    return rows.map((row) => ({
      matricNumber: row.matricNumber,
      fullName: row.fullName,
      emailOnly: row.matricNumber.startsWith('JUPEB-'),
      seededEmail: row.seededEmail ? maskEmail(row.seededEmail) : null,
      account: row.account ? {
        id: row.account.id,
        name: row.account.fullName,
        email: maskEmail(row.account.email),
        registeredAt: row.account.createdAt,
        suspended: !!row.account.suspendedAt,
        suspendedReason: row.account.suspendedReason,
      } : null,
    }));
  }

  async suspendStudent(user: StaffUser, id: string, studentId: string, body: Record<string, unknown>) {
    this.require(user, 'moderateVoters');
    await this.load(id);
    const student = await this.repo.findStudent(studentId);
    if (!student || !(await this.repo.isOnRoll(id, student.matricNumber))) throw notFound('Student not found on this voter list.');
    const suspend = body.suspend !== false;
    const reason = suspend ? text(body.reason, 'Reason', { max: 300, required: true })! : '';
    await this.repo.setSuspended(studentId, suspend ? { at: new Date(), reason } : null);
    forgetStudentSession(studentId);
    await this.repo.audit(id, this.actor(user), suspend ? 'account-suspended' : 'account-restored', { matricNumber: student.matricNumber, name: student.fullName, ...(suspend ? { reason } : {}) });
    return { ok: true };
  }

  async auditLog(user: StaffUser, id: string) {
    this.require(user, 'view');
    await this.load(id);
    const entries = await this.repo.auditLog(id);
    return entries.map((entry) => ({ id: entry.id, at: entry.createdAt, actor: entry.actorName, role: entry.actorRole, action: entry.action, detail: entry.detail }));
  }

  async turnoutTimeline(user: StaffUser, id: string) {
    this.require(user, 'view');
    await this.load(id);
    return this.repo.turnoutTimeline(id);
  }

  async committee(user: StaffUser) {
    this.require(user, 'manageCommittee');
    return this.repo.committeeMembers();
  }
}

export const electionAdminService = new ElectionAdminService();
