import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import type { Notice, NoticeAudience, NoticeElection, NoticeMessage } from '../domain/electionNotices';

export type NotifiableElection = NoticeElection & { registrationDeadline: Date | null };

export interface NoticeRecipient {
  id: string;
  fullName: string;
  email: string;
  subscriptionIds: string[];
}

const NOTIFIABLE_SELECT = {
  id: true, title: true, isTest: true, status: true, opensAt: true, closesAt: true,
  openedAt: true, publishedAt: true, registrationDeadline: true,
} as const;

/** Data access for election notices. Push delivery itself goes through the Bulletin's outbox and worker. */
export class ElectionNotificationRepository {
  /** Real elections that could have a notice due: not closed yet, or published in the last 6 hours. */
  activeElections(now: Date): Promise<NotifiableElection[]> {
    return prisma.election.findMany({
      where: {
        isTest: false,
        OR: [
          { status: { in: ['ready', 'open', 'paused'] } },
          { status: 'published', publishedAt: { gt: new Date(now.getTime() - 6 * 60 * 60_000) } },
        ],
      },
      select: NOTIFIABLE_SELECT,
    });
  }

  /** Records the notice; returns null if it was already sent (the unique key decides, so this is race-safe). */
  async claim(electionId: string, notice: Notice, sentByName: string | null): Promise<{ id: string } | null> {
    try {
      return await prisma.electionNotification.create({
        data: { electionId, key: notice.key, kind: notice.kind, sentByName },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  /**
   * Students on the voter list with an account. "canVote" and "notVoted" leave out suspended
   * accounts and accounts made after the registration deadline (they can't vote).
   */
  async recipients(electionId: string, audience: NoticeAudience, registrationDeadline: Date | null): Promise<NoticeRecipient[]> {
    const roll = await prisma.electionVoterRoll.findMany({ where: { electionId }, select: { matricNumber: true } });
    if (!roll.length) return [];
    const accounts = await prisma.studentAccount.findMany({
      where: {
        matricNumber: { in: roll.map((row) => row.matricNumber) },
        suspendedAt: null,
        ...(audience !== 'everyone' && registrationDeadline ? { createdAt: { lte: registrationDeadline } } : {}),
        ...(audience === 'notVoted' ? { electionVotes: { none: { electionId } } } : {}),
      },
      select: { id: true, fullName: true, email: true, pushSubscriptions: { select: { id: true } } },
    });
    return accounts.map((account) => ({
      id: account.id,
      fullName: account.fullName,
      email: account.email,
      subscriptionIds: account.pushSubscriptions.map((subscription) => subscription.id),
    }));
  }

  async enqueuePush(subscriptionIds: string[], message: NoticeMessage): Promise<void> {
    const payload = { ...message, priority: 'important' } as unknown as Prisma.InputJsonValue;
    await prisma.notificationOutbox.createMany({ data: subscriptionIds.map((subscriptionId) => ({ subscriptionId, payload })) });
  }

  async record(id: string, counts: { pushQueued?: number; emailsSent?: number }): Promise<void> {
    await prisma.electionNotification.update({ where: { id }, data: counts });
  }

  async history(electionId: string) {
    return prisma.electionNotification.findMany({ where: { electionId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async lastReminderAt(electionId: string): Promise<Date | null> {
    const last = await prisma.electionNotification.findFirst({ where: { electionId, kind: 'reminder' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    return last?.createdAt ?? null;
  }
}

export const electionNotificationRepository = new ElectionNotificationRepository();
