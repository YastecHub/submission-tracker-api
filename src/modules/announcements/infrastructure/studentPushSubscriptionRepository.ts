import prisma from '../../../lib/prisma';
import type { StudentPushSubscriptionInput } from '../domain/studentPushSubscription';

export class StudentPushSubscriptionRepository {
  save(studentId: string, input: StudentPushSubscriptionInput, userAgent: string | null) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.studentPushSubscription.findUnique({
        where: { endpoint: input.endpoint },
        select: { id: true, studentId: true },
      });
      if (existing && existing.studentId !== studentId) {
        await tx.notificationOutbox.updateMany({
          where: { subscriptionId: existing.id, status: { in: ['pending', 'processing'] } },
          data: { status: 'dead', lockedAt: null, lastError: 'Notification subscription changed owner' },
        });
      }
      return tx.studentPushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: { ...input, studentId, userAgent, lastSeenAt: new Date() },
        update: { ...input, studentId, userAgent, lastSeenAt: new Date() },
        select: { id: true, createdAt: true, updatedAt: true },
      });
    });
  }

  async isOwned(studentId: string, endpoint: string) {
    return (await prisma.studentPushSubscription.count({ where: { studentId, endpoint } })) > 0;
  }

  remove(studentId: string, endpoint: string) {
    return prisma.$transaction(async (tx) => {
      const subscription = await tx.studentPushSubscription.findFirst({
        where: { studentId, endpoint },
        select: { id: true },
      });
      if (!subscription) return { count: 0 };
      await tx.notificationOutbox.updateMany({
        where: { subscriptionId: subscription.id, status: { in: ['pending', 'processing'] } },
        data: { status: 'dead', lockedAt: null, lastError: 'Notifications disabled by student' },
      });
      return tx.studentPushSubscription.deleteMany({ where: { id: subscription.id } });
    });
  }
}

export const studentPushSubscriptionRepository = new StudentPushSubscriptionRepository();
