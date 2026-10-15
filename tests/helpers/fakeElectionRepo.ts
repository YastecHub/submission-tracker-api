import { randomUUID } from 'node:crypto';
import { castHour, effectiveStatus, type ElectionStatus, type ValidChoice } from '../../src/modules/elections/domain/electionRules';
import type { VoterRow } from '../../src/modules/elections/domain/voterList';
import type { ElectionRepository, CastResult } from '../../src/modules/elections/infrastructure/electionRepository';

/** In-memory stand-in for ElectionRepository: same rules, no database. Used by tests and the browser-test API. */
export function createFakeElectionRepo() {
  const now = () => new Date();
  const db = {
    elections: [] as any[],
    positions: [] as any[],
    candidates: [] as any[],
    roll: [] as Array<{ electionId: string; matricNumber: string; fullName: string }>,
    records: [] as Array<{ id: string; electionId: string; studentId: string; matricNumber: string; requestId: string; votedAt: Date }>,
    ballots: [] as Array<{ id: string; electionId: string; receiptHash: string; castHour: Date; choices: ValidChoice[] }>,
    approvals: [] as Array<{ electionId: string; userId: string; createdAt: Date; user: { id: string; name: string } }>,
    audit: [] as any[],
    students: [] as Array<{ id: string; matricNumber: string; fullName: string; email: string; createdAt: Date; suspendedAt: Date | null; suspendedReason: string | null }>,
    roster: [] as Array<{ matricNumber: string; fullName: string; email: string | null }>,
    users: [] as Array<{ id: string; name: string; email: string; role: string; createdAt: Date }>,
  };
  const withSetup = (election: any) => election && ({
    ...election,
    positions: db.positions.filter((p) => p.electionId === election.id).sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({ ...p, candidates: db.candidates.filter((c) => c.positionId === p.id).sort((a, b) => a.sortOrder - b.sortOrder) })),
  });
  const repo = {
    async list() {
      return db.elections.map((e) => ({ ...e, _count: {
        positions: db.positions.filter((p) => p.electionId === e.id).length,
        candidates: db.candidates.filter((c) => c.electionId === e.id).length,
        voterRoll: db.roll.filter((r) => r.electionId === e.id).length,
        voteRecords: db.records.filter((r) => r.electionId === e.id).length,
      } }));
    },
    async find(id: string) { return withSetup(db.elections.find((e) => e.id === id)) ?? null; },
    async create(data: any) {
      const election = { id: randomUUID(), status: 'draft', openedAt: null, closedAt: null, publishedAt: null, version: 1, createdAt: now(), updatedAt: now(), ...data };
      db.elections.push(election); return election;
    },
    async updateIf(id: string, statuses: ElectionStatus[], data: any) {
      const e = db.elections.find((x) => x.id === id && statuses.includes(x.status));
      if (!e) return false;
      Object.assign(e, data, { version: e.version + 1, updatedAt: now() }); return true;
    },
    async delete(id: string) {
      db.elections = db.elections.filter((e) => e.id !== id);
      for (const key of ['positions', 'candidates', 'roll', 'records', 'ballots', 'approvals', 'audit'] as const) (db as any)[key] = (db as any)[key].filter((x: any) => x.electionId !== id);
    },
    async countPositions(electionId: string) { return db.positions.filter((p) => p.electionId === electionId).length; },
    async createPosition(electionId: string, title: string, sortOrder: number) {
      const p = { id: randomUUID(), electionId, title, sortOrder, createdAt: now() }; db.positions.push(p); return p;
    },
    async findPosition(electionId: string, positionId: string) { return db.positions.find((p) => p.id === positionId && p.electionId === electionId) ?? null; },
    async updatePosition(positionId: string, data: any) { const p = db.positions.find((x) => x.id === positionId); Object.assign(p, data); return p; },
    async deletePosition(positionId: string) { db.positions = db.positions.filter((p) => p.id !== positionId); db.candidates = db.candidates.filter((c) => c.positionId !== positionId); },
    async createCandidate(data: any) { const c = { id: randomUUID(), createdAt: now(), nickname: null, manifesto: null, photoUrl: null, photoPublicId: null, matricNumber: null, ...data }; db.candidates.push(c); return c; },
    async findCandidate(electionId: string, candidateId: string) { return db.candidates.find((c) => c.id === candidateId && c.electionId === electionId) ?? null; },
    async updateCandidate(candidateId: string, data: any) { const c = db.candidates.find((x) => x.id === candidateId); Object.assign(c, data); return c; },
    async deleteCandidate(candidateId: string) { db.candidates = db.candidates.filter((c) => c.id !== candidateId); },
    async replaceVoterRoll(electionId: string, rows: VoterRow[]) {
      db.roll = db.roll.filter((r) => r.electionId !== electionId).concat(rows.map((r) => ({ electionId, matricNumber: r.matricNumber, fullName: r.fullName })));
      for (const row of rows) {
        const existing = db.roster.find((r) => r.matricNumber === row.matricNumber);
        if (existing) { existing.fullName = row.fullName; if (row.email) existing.email = row.email; } else db.roster.push({ matricNumber: row.matricNumber, fullName: row.fullName, email: row.email });
      }
    },
    async addVoters(electionId: string, rows: VoterRow[]) {
      let added = 0;
      for (const row of rows) if (!db.roll.some((r) => r.electionId === electionId && r.matricNumber === row.matricNumber)) { db.roll.push({ electionId, matricNumber: row.matricNumber, fullName: row.fullName }); added += 1; }
      return added;
    },
    async rosterEmailClashes() { return []; },
    async rollMatrics(electionId: string) { return new Set(db.roll.filter((r) => r.electionId === electionId).map((r) => r.matricNumber)); },
    async isOnRoll(electionId: string, matricNumber: string) { return db.roll.find((r) => r.electionId === electionId && r.matricNumber === matricNumber) ?? null; },
    async registrations(electionId: string) {
      return db.roll.filter((r) => r.electionId === electionId).map((r) => ({ ...r, createdAt: now(), seededEmail: db.roster.find((x) => x.matricNumber === r.matricNumber)?.email ?? null,
        account: db.students.find((s) => s.matricNumber === r.matricNumber) ?? null }));
    },
    async turnout(electionId: string) {
      return { voted: db.records.filter((r) => r.electionId === electionId).length, eligible: db.roll.filter((r) => r.electionId === electionId).length };
    },
    async registeredCount(electionId: string) {
      return db.roll.filter((r) => r.electionId === electionId && db.students.some((s) => s.matricNumber === r.matricNumber && !s.suspendedAt)).length;
    },
    async turnoutTimeline() { return []; },
    async voteRecordFor(electionId: string, studentId: string) {
      const r = db.records.find((x) => x.electionId === electionId && x.studentId === studentId); return r ? { votedAt: r.votedAt, requestId: r.requestId } : null;
    },
    async votedElectionIds(studentId: string) { return new Map(db.records.filter((r) => r.studentId === studentId).map((r) => [r.electionId, r.votedAt])); },
    async electionsForMatric(matricNumber: string) {
      return db.elections.filter((e) => e.status !== 'draft' && db.roll.some((r) => r.electionId === e.id && r.matricNumber === matricNumber)).map(withSetup);
    },
    async castVote(input: any): Promise<CastResult> {
      const e = db.elections.find((x) => x.id === input.electionId);
      if (!e || effectiveStatus(e) !== 'open') return { ok: false, reason: 'not-open', status: e ? effectiveStatus(e) : undefined };
      const existing = db.records.find((r) => r.electionId === input.electionId && (r.studentId === input.studentId || r.matricNumber === input.matricNumber));
      if (existing) return existing.requestId === input.requestId ? { ok: true, votedAt: existing.votedAt, repeated: true } : { ok: false, reason: 'already-voted', votedAt: existing.votedAt };
      if (db.ballots.some((b) => b.electionId === input.electionId && b.receiptHash === input.receiptHash)) return { ok: false, reason: 'receipt-taken' };
      const votedAt = now();
      db.records.push({ id: randomUUID(), electionId: input.electionId, studentId: input.studentId, matricNumber: input.matricNumber, requestId: input.requestId, votedAt });
      db.ballots.push({ id: randomUUID(), electionId: input.electionId, receiptHash: input.receiptHash, castHour: castHour(votedAt), choices: input.choices });
      return { ok: true, votedAt, repeated: false };
    },
    async ballotCount(electionId: string) { return db.ballots.filter((b) => b.electionId === electionId).length; },
    async allChoices(electionId: string) { return db.ballots.filter((b) => b.electionId === electionId).flatMap((b) => b.choices); },
    async receiptExists(electionId: string, hash: string) { return db.ballots.some((b) => b.electionId === electionId && b.receiptHash === hash); },
    async addApproval(electionId: string, userId: string) {
      if (!db.approvals.some((a) => a.electionId === electionId && a.userId === userId)) {
        const user = db.users.find((u) => u.id === userId) ?? { id: userId, name: userId };
        db.approvals.push({ electionId, userId, createdAt: now(), user: { id: user.id, name: user.name } });
      }
    },
    async approvals(electionId: string) { return db.approvals.filter((a) => a.electionId === electionId); },
    async audit(electionId: string, actor: any, action: string, detail?: any) { db.audit.push({ id: randomUUID(), electionId, actorName: actor.name, actorRole: actor.role, action, detail, createdAt: now() }); },
    async auditLog(electionId: string) { return db.audit.filter((a) => a.electionId === electionId).reverse(); },
    async dueForTransition(at: Date) {
      return db.elections.filter((e) => (e.status === 'ready' && e.opensAt <= at) || (['ready', 'open', 'paused'].includes(e.status) && e.closesAt <= at))
        .map((e) => ({ id: e.id, status: e.status, opensAt: e.opensAt, closesAt: e.closesAt }));
    },
    async committeeMembers() { return db.users.filter((u) => u.role === 'electoral_committee'); },
    async findStudent(id: string) { return db.students.find((s) => s.id === id) ?? null; },
    async setSuspended(studentId: string, suspended: { at: Date; reason: string } | null) {
      const s = db.students.find((x) => x.id === studentId)!;
      s.suspendedAt = suspended?.at ?? null; s.suspendedReason = suspended?.reason ?? null; return s;
    },
  };
  return { repo: repo as unknown as ElectionRepository, db };
}
