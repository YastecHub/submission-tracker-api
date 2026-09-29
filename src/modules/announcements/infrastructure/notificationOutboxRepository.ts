import { NotificationOutboxStatus, Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export interface ClaimedNotification {
  id: string;
  subscriptionId: string | null;
  payload: Prisma.JsonValue;
  attempts: number;
}

export class NotificationOutboxRepository {
  claim(limit: number): Promise<ClaimedNotification[]> {
    return prisma.$queryRaw<ClaimedNotification[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "NotificationOutbox"
        WHERE (
          "status" = 'pending'::"NotificationOutboxStatus"
          AND "availableAt" <= CURRENT_TIMESTAMP
        ) OR (
          "status" = 'processing'::"NotificationOutboxStatus"
          AND "lockedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
        )
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "NotificationOutbox" AS outbox
      SET "status" = 'processing'::"NotificationOutboxStatus",
          "attempts" = outbox."attempts" + 1,
          "lockedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM candidates
      WHERE outbox."id" = candidates."id"
      RETURNING outbox."id", outbox."subscriptionId", outbox."payload", outbox."attempts"
    `);
  }

  findSubscription(id: string) {
    return prisma.studentPushSubscription.findUnique({
      where: { id },
      select: { id: true, endpoint: true, p256dh: true, auth: true, expirationTime: true },
    });
  }

  complete(id: string) {
    return this.transition(id, 'delivered', {
      deliveredAt: new Date(),
      lockedAt: null,
      lastError: null,
    });
  }

  retry(id: string, availableAt: Date, error: string) {
    return this.transition(id, 'pending', { availableAt, lockedAt: null, lastError: error });
  }

  dead(id: string, error: string) {
    return this.transition(id, 'dead', { lockedAt: null, lastError: error });
  }

  invalidateSubscription(subscriptionId: string, error: string) {
    return prisma.$transaction(async (tx) => {
      await tx.notificationOutbox.updateMany({
        where: { subscriptionId, status: { in: ['pending', 'processing'] } },
        data: { status: 'dead', lockedAt: null, lastError: error },
      });
      await tx.studentPushSubscription.deleteMany({ where: { id: subscriptionId } });
    });
  }

  private transition(
    id: string,
    status: NotificationOutboxStatus,
    data: Prisma.NotificationOutboxUpdateManyMutationInput,
  ) {
    return prisma.notificationOutbox.updateMany({
      where: { id, status: 'processing' },
      data: { ...data, status },
    });
  }
}

export const notificationOutboxRepository = new NotificationOutboxRepository();
