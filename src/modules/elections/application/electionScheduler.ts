import logger from '../../../lib/logger';
import { effectiveStatus } from '../domain/electionRules';
import { electionRepository } from '../infrastructure/electionRepository';
import { announceElection } from './electionBroadcast';

const SYSTEM = { id: null, name: 'NEXIUM', role: 'system' };

/**
 * Opens and closes elections on time and tells every open page. Voting itself never
 * depends on this timer: each vote re-checks the clock, so a late tick can't let a vote
 * through after closing. Updates are conditional, so several servers can run it safely.
 */
export async function runElectionSchedule(now: Date = new Date()): Promise<number> {
  const due = await electionRepository.dueForTransition(now);
  let changed = 0;
  for (const election of due) {
    const target = effectiveStatus(election, now);
    if (target === 'closed') {
      if (await electionRepository.updateIf(election.id, [election.status], { status: 'closed', closedAt: election.closesAt })) {
        await electionRepository.audit(election.id, SYSTEM, 'auto-closed');
        announceElection(election.id, 0);
        changed += 1;
      }
    } else if (target === 'open' && election.status === 'ready') {
      if (await electionRepository.updateIf(election.id, ['ready'], { status: 'open', openedAt: election.opensAt })) {
        await electionRepository.audit(election.id, SYSTEM, 'auto-opened');
        announceElection(election.id, 0);
        changed += 1;
      }
    }
  }
  return changed;
}

export function startElectionScheduler(intervalMs = 5_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runElectionSchedule()
      .catch((error) => logger.warn('[elections] schedule tick failed', { error }))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
