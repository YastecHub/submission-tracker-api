import { cacheDelete, cacheGet, cacheSet } from '../../../utils/cache';
import { studentAccountRepository } from '../infrastructure/studentAccountRepository';

const SESSION_CACHE_MS = 60_000;

interface SessionState {
  exists: boolean;
  passwordChangedAt: number | null;
  /** Suspended by the electoral committee: every session ends. */
  suspended?: boolean;
}

const cacheKey = (studentId: string) => `student-session:${studentId}`;

/**
 * Student tokens are stateless JWTs, so a password reset has to be checked here:
 * a token issued before the password last changed (or for a deleted account) is no
 * longer valid. The lookup is cached per student for a minute.
 */
export function isSessionCurrent(state: SessionState, issuedAtSeconds: number | undefined): boolean {
  if (!state.exists || state.suspended) return false;
  if (state.passwordChangedAt === null) return true;
  return (issuedAtSeconds ?? 0) >= Math.floor(state.passwordChangedAt / 1000);
}

export async function studentSessionIsCurrent(studentId: string, issuedAtSeconds: number | undefined): Promise<boolean> {
  let state = cacheGet<SessionState>(cacheKey(studentId));
  if (!state) {
    const row = await studentAccountRepository.findSessionState(studentId);
    state = { exists: !!row, passwordChangedAt: row?.passwordChangedAt?.getTime() ?? null, suspended: !!row?.suspendedAt };
    cacheSet(cacheKey(studentId), state, SESSION_CACHE_MS);
  }
  return isSessionCurrent(state, issuedAtSeconds);
}

export function forgetStudentSession(studentId: string): void {
  cacheDelete(cacheKey(studentId));
}
