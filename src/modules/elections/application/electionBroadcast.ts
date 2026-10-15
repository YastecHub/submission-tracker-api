import logger from '../../../lib/logger';
import { emitToSignedIn, emitToStudent } from '../../../realtime/hub';
import { effectiveStatus } from '../domain/electionRules';
import { electionRepository } from '../infrastructure/electionRepository';

const pending = new Map<string, NodeJS.Timeout>();

export interface ElectionLiveUpdate {
  electionId: string;
  status: string;
  opensAt: string;
  closesAt: string;
  publishedAt: string | null;
  voted: number;
  eligible: number;
}

/**
 * Tells every open page that an election changed (status, times or turnout). Bursts of
 * votes are coalesced into one update per election every ~0.75 s.
 */
export function announceElection(electionId: string, delayMs = 750): void {
  if (pending.has(electionId)) return;
  pending.set(electionId, setTimeout(() => {
    pending.delete(electionId);
    void sendUpdate(electionId);
  }, delayMs));
}

async function sendUpdate(electionId: string): Promise<void> {
  try {
    const election = await electionRepository.find(electionId);
    if (!election) {
      emitToSignedIn('election:removed', { electionId });
      return;
    }
    const turnout = await electionRepository.turnout(electionId);
    const update: ElectionLiveUpdate = {
      electionId,
      status: effectiveStatus(election),
      opensAt: election.opensAt.toISOString(),
      closesAt: election.closesAt.toISOString(),
      publishedAt: election.publishedAt?.toISOString() ?? null,
      voted: turnout.voted,
      eligible: turnout.eligible,
    };
    emitToSignedIn('election:update', update);
  } catch (error) {
    logger.warn('[elections] live update failed', { error, electionId });
  }
}

/** The student's other phones/tabs flip to "You have voted" straight away. */
export function announceVote(studentId: string, electionId: string, votedAt: Date): void {
  emitToStudent(studentId, 'election:voted', { electionId, votedAt: votedAt.toISOString() });
  announceElection(electionId);
}
