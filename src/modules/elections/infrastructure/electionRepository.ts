import { Prisma, type ElectionStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { castHour, effectiveStatus, type ValidChoice } from '../domain/electionRules';
import type { VoterRow } from '../domain/voterList';

const positionsWithCandidates = {
  orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  include: { candidates: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] } },
};

export type ElectionWithSetup = Prisma.ElectionGetPayload<{ include: { positions: { include: { candidates: true } } } }>;

export interface Actor {
  id: string | null;
  name: string;
  role: string;
}

export type CastResult =
  | { ok: true; votedAt: Date; repeated: boolean }
  | { ok: false; reason: 'already-voted' | 'not-open' | 'receipt-taken'; status?: ElectionStatus; votedAt?: Date };

export class ElectionRepository {
  list() {
    return prisma.election.findMany({
      orderBy: [{ opensAt: 'desc' }],
      include: { _count: { select: { positions: true, candidates: true, voterRoll: true, voteRecords: true } } },
    });
  }

  find(id: string): Promise<ElectionWithSetup | null> {
    return prisma.election.findUnique({ where: { id }, include: { positions: positionsWithCandidates } });
  }

  create(data: { title: string; description: string | null; opensAt: Date; closesAt: Date; registrationDeadline: Date | null; isTest: boolean; createdById: string }) {
    return prisma.election.create({ data });
  }

  /** Updates only while the election is still in one of `statuses` (guards against races). */
  async updateIf(id: string, statuses: ElectionStatus[], data: Prisma.ElectionUpdateManyMutationInput): Promise<boolean> {
    const result = await prisma.election.updateMany({ where: { id, status: { in: statuses } }, data: { ...data, version: { increment: 1 } } });
    return result.count === 1;
  }

  delete(id: string) {
    return prisma.election.delete({ where: { id } });
  }

  countPositions(electionId: string) {
    return prisma.electionPosition.count({ where: { electionId } });
  }

  createPosition(electionId: string, title: string, sortOrder: number) {
    return prisma.electionPosition.create({ data: { electionId, title, sortOrder } });
  }

  findPosition(electionId: string, positionId: string) {
    return prisma.electionPosition.findFirst({ where: { id: positionId, electionId }, include: { candidates: true } });
  }

  updatePosition(positionId: string, data: { title?: string; sortOrder?: number }) {
    return prisma.electionPosition.update({ where: { id: positionId }, data });
  }

  deletePosition(positionId: string) {
    return prisma.electionPosition.delete({ where: { id: positionId } });
  }

  createCandidate(data: Prisma.ElectionCandidateUncheckedCreateInput) {
    return prisma.electionCandidate.create({ data });
  }

  findCandidate(electionId: string, candidateId: string) {
    return prisma.electionCandidate.findFirst({ where: { id: candidateId, electionId } });
  }

  updateCandidate(candidateId: string, data: Prisma.ElectionCandidateUncheckedUpdateInput) {
    return prisma.electionCandidate.update({ where: { id: candidateId }, data });
  }

  deleteCandidate(candidateId: string) {
    return prisma.electionCandidate.delete({ where: { id: candidateId } });
  }

  /**
   * Replaces the voter list and adds every voter to the student list (so they can
   * register). Existing student-list entries get the official name; a seeded email is
   * only set when given.
   */
  async replaceVoterRoll(electionId: string, rows: VoterRow[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.electionVoterRoll.deleteMany({ where: { electionId } });
      await tx.electionVoterRoll.createMany({ data: rows.map((row) => ({ electionId, matricNumber: row.matricNumber, fullName: row.fullName })) });
      await this.upsertRoster(tx, rows);
    }, { maxWait: 15_000, timeout: 60_000 });
  }

  /** Adds voters without removing anyone (allowed after setup is locked, e.g. a late correction). */
  async addVoters(electionId: string, rows: VoterRow[]): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const result = await tx.electionVoterRoll.createMany({
        data: rows.map((row) => ({ electionId, matricNumber: row.matricNumber, fullName: row.fullName })),
        skipDuplicates: true,
      });
      await this.upsertRoster(tx, rows);
      return result.count;
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  private async upsertRoster(tx: Prisma.TransactionClient, rows: VoterRow[]) {
    for (const row of rows) {
      await tx.studentRoster.upsert({
        where: { matricNumber: row.matricNumber },
        create: { matricNumber: row.matricNumber, fullName: row.fullName, email: row.email },
        update: { fullName: row.fullName, ...(row.email ? { email: row.email } : {}) },
      });
    }
  }

  /** Emails already used by another student-list entry (they must stay unique). */
  async rosterEmailClashes(rows: VoterRow[]): Promise<Array<{ email: string; matricNumber: string }>> {
    const emails = rows.filter((row) => row.email).map((row) => row.email!);
    if (!emails.length) return [];
    const owners = await prisma.studentRoster.findMany({ where: { email: { in: emails } }, select: { email: true, matricNumber: true } });
    const wanted = new Map(rows.filter((row) => row.email).map((row) => [row.email!, row.matricNumber]));
    return owners.filter((owner) => owner.email && wanted.get(owner.email) !== owner.matricNumber).map((owner) => ({ email: owner.email!, matricNumber: owner.matricNumber }));
  }

  async rollMatrics(electionId: string): Promise<Set<string>> {
    const rows = await prisma.electionVoterRoll.findMany({ where: { electionId }, select: { matricNumber: true } });
    return new Set(rows.map((row) => row.matricNumber));
  }

  isOnRoll(electionId: string, matricNumber: string) {
    return prisma.electionVoterRoll.findUnique({ where: { electionId_matricNumber: { electionId, matricNumber } } });
  }

  /** Voter list joined with accounts, for the setup and committee screens. */
  async registrations(electionId: string) {
    const roll = await prisma.electionVoterRoll.findMany({ where: { electionId }, orderBy: { fullName: 'asc' } });
    const accounts = await prisma.studentAccount.findMany({
      where: { matricNumber: { in: roll.map((row) => row.matricNumber) } },
      select: { id: true, matricNumber: true, email: true, fullName: true, createdAt: true, suspendedAt: true, suspendedReason: true },
    });
    const byMatric = new Map(accounts.map((account) => [account.matricNumber, account]));
    const roster = await prisma.studentRoster.findMany({ where: { matricNumber: { in: roll.map((row) => row.matricNumber) } }, select: { matricNumber: true, email: true } });
    const seeded = new Map(roster.map((row) => [row.matricNumber, row.email]));
    return roll.map((row) => ({ ...row, seededEmail: seeded.get(row.matricNumber) ?? null, account: byMatric.get(row.matricNumber) ?? null }));
  }

  async turnout(electionId: string): Promise<{ voted: number; eligible: number }> {
    const [voted, eligible] = await Promise.all([
      prisma.electionVoteRecord.count({ where: { electionId } }),
      prisma.electionVoterRoll.count({ where: { electionId } }),
    ]);
    return { voted, eligible };
  }

  async registeredCount(electionId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "ElectionVoterRoll" r
      JOIN "StudentAccount" a ON a."matricNumber" = r."matricNumber"
      WHERE r."electionId" = ${electionId} AND a."suspendedAt" IS NULL`;
    return Number(rows[0]?.count ?? 0);
  }

  /** Votes per 10 minutes, for the committee's turnout chart (counts only). */
  async turnoutTimeline(electionId: string): Promise<Array<{ at: Date; count: number }>> {
    const rows = await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT to_timestamp(floor(extract(epoch FROM "votedAt") / 600) * 600) AS bucket, COUNT(*)::bigint AS count
      FROM "ElectionVoteRecord" WHERE "electionId" = ${electionId}
      GROUP BY bucket ORDER BY bucket`;
    return rows.map((row) => ({ at: row.bucket, count: Number(row.count) }));
  }

  voteRecordFor(electionId: string, studentId: string) {
    return prisma.electionVoteRecord.findUnique({ where: { electionId_studentId: { electionId, studentId } }, select: { votedAt: true, requestId: true } });
  }

  async votedElectionIds(studentId: string): Promise<Map<string, Date>> {
    const rows = await prisma.electionVoteRecord.findMany({ where: { studentId }, select: { electionId: true, votedAt: true } });
    return new Map(rows.map((row) => [row.electionId, row.votedAt]));
  }

  electionsForMatric(matricNumber: string) {
    return prisma.election.findMany({
      where: { status: { not: 'draft' }, voterRoll: { some: { matricNumber } } },
      orderBy: { opensAt: 'desc' },
      include: { positions: positionsWithCandidates },
    });
  }

  /**
   * Records the vote. Who voted and what was voted go to two unlinked tables in one
   * transaction. The open/closed check is repeated inside the transaction with the
   * server clock, and the unique (election, student) rule makes double voting
   * impossible even with simultaneous requests.
   */
  async castVote(input: { electionId: string; studentId: string; matricNumber: string; requestId: string; receiptHash: string; choices: ValidChoice[] }): Promise<CastResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const election = await tx.election.findUnique({ where: { id: input.electionId }, select: { status: true, opensAt: true, closesAt: true } });
        const now = new Date();
        if (!election || effectiveStatus(election, now) !== 'open') {
          return { ok: false as const, reason: 'not-open' as const, status: election ? effectiveStatus(election, now) : undefined };
        }
        const record = await tx.electionVoteRecord.create({
          data: { electionId: input.electionId, studentId: input.studentId, matricNumber: input.matricNumber, requestId: input.requestId },
          select: { votedAt: true },
        });
        await tx.electionBallot.create({
          data: {
            electionId: input.electionId,
            receiptHash: input.receiptHash,
            castHour: castHour(now),
            choices: { create: input.choices.map((choice) => ({ positionId: choice.positionId, candidateId: choice.candidateId, approve: choice.approve })) },
          },
        });
        return { ok: true as const, votedAt: record.votedAt, repeated: false };
      }, { maxWait: 10_000, timeout: 20_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.voteRecordFor(input.electionId, input.studentId);
        if (existing) {
          // The same submission arriving again (e.g. a retry after a dropped connection).
          if (existing.requestId === input.requestId) return { ok: true, votedAt: existing.votedAt, repeated: true };
          return { ok: false, reason: 'already-voted', votedAt: existing.votedAt };
        }
        const byMatric = await prisma.electionVoteRecord.findUnique({ where: { electionId_matricNumber: { electionId: input.electionId, matricNumber: input.matricNumber } }, select: { votedAt: true } });
        if (byMatric) return { ok: false, reason: 'already-voted', votedAt: byMatric.votedAt };
        return { ok: false, reason: 'receipt-taken' };
      }
      throw error;
    }
  }

  ballotCount(electionId: string) {
    return prisma.electionBallot.count({ where: { electionId } });
  }

  allChoices(electionId: string) {
    return prisma.electionBallotChoice.findMany({ where: { ballot: { electionId } }, select: { positionId: true, candidateId: true, approve: true } });
  }

  async receiptExists(electionId: string, receiptHash: string): Promise<boolean> {
    return !!(await prisma.electionBallot.findUnique({ where: { electionId_receiptHash: { electionId, receiptHash } }, select: { id: true } }));
  }

  addApproval(electionId: string, userId: string) {
    return prisma.electionPublishApproval.upsert({ where: { electionId_userId: { electionId, userId } }, create: { electionId, userId }, update: {} });
  }

  approvals(electionId: string) {
    return prisma.electionPublishApproval.findMany({ where: { electionId }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  }

  audit(electionId: string, actor: Actor, action: string, detail?: Prisma.InputJsonValue) {
    return prisma.electionAuditLog.create({
      data: { electionId, actorUserId: actor.id, actorName: actor.name, actorRole: actor.role, action, detail: detail ?? Prisma.JsonNull },
    });
  }

  auditLog(electionId: string) {
    return prisma.electionAuditLog.findMany({ where: { electionId }, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  /** Elections whose clock says they should open or close now. */
  dueForTransition(now: Date) {
    return prisma.election.findMany({
      where: {
        OR: [
          { status: 'ready', opensAt: { lte: now } },
          { status: { in: ['ready', 'open', 'paused'] }, closesAt: { lte: now } },
        ],
      },
      select: { id: true, status: true, opensAt: true, closesAt: true },
    });
  }

  committeeMembers() {
    return prisma.user.findMany({ where: { role: 'electoral_committee' }, select: { id: true, name: true, email: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  }

  findStudent(id: string) {
    return prisma.studentAccount.findUnique({ where: { id }, select: { id: true, matricNumber: true, fullName: true, email: true, createdAt: true, suspendedAt: true } });
  }

  setSuspended(studentId: string, suspended: { at: Date; reason: string } | null) {
    return prisma.studentAccount.update({
      where: { id: studentId },
      data: suspended ? { suspendedAt: suspended.at, suspendedReason: suspended.reason } : { suspendedAt: null, suspendedReason: null },
      select: { id: true, matricNumber: true, fullName: true, suspendedAt: true },
    });
  }
}

export const electionRepository = new ElectionRepository();
