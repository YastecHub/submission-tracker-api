import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import logger from '../../lib/logger';
import { isPushConfigured, sendPush } from '../../utils/pushNotifier';
import { CLASS_ROLES } from '../auth/domain/classRepAccess';

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  priority?: 'normal' | 'important' | 'urgent';
}

export class PushNotificationService {
  /**
   * Broadcast a notification to all subscribed students through the NotificationOutbox.
   */
  async broadcastToStudents(message: PushMessage): Promise<number> {
    if (!isPushConfigured()) return 0;
    try {
      const subscriptions = await prisma.studentPushSubscription.findMany({
        select: { id: true },
      });
      if (!subscriptions.length) return 0;

      const payload = {
        title: message.title,
        body: message.body,
        url: message.url,
        tag: message.tag,
        priority: message.priority ?? 'normal',
      } as unknown as Prisma.InputJsonValue;

      const result = await prisma.notificationOutbox.createMany({
        data: subscriptions.map((s) => ({
          subscriptionId: s.id,
          payload,
        })),
      });

      return result.count;
    } catch (error) {
      logger.error('[push broadcast error]', { error: error instanceof Error ? error.message : error });
      return 0;
    }
  }

  /**
   * Send a targeted notification to a specific student using their matric number.
   */
  async notifyStudentByMatric(matricNumber: string, message: PushMessage): Promise<number> {
    if (!isPushConfigured()) return 0;
    try {
      const student = await prisma.studentAccount.findUnique({
        where: { matricNumber: matricNumber.trim().toUpperCase() },
        select: { pushSubscriptions: { select: { id: true } } },
      });
      if (!student || !student.pushSubscriptions.length) return 0;

      const payload = {
        title: message.title,
        body: message.body,
        url: message.url,
        tag: message.tag,
        priority: message.priority ?? 'important',
      } as unknown as Prisma.InputJsonValue;

      const result = await prisma.notificationOutbox.createMany({
        data: student.pushSubscriptions.map((s) => ({
          subscriptionId: s.id,
          payload,
        })),
      });

      return result.count;
    } catch (error) {
      logger.error('[push student notify error]', { error: error instanceof Error ? error.message : error, matricNumber });
      return 0;
    }
  }

  /**
   * Notify class reps (CR, ACR, Fin Sec, Dev) who have enabled notifications.
   */
  async notifyClassReps(message: { title: string; body: string; url: string; tag?: string }): Promise<void> {
    if (!isPushConfigured()) return;
    try {
      const reps = await prisma.user.findMany({
        where: {
          role: { in: CLASS_ROLES },
          pushSubscription: { not: null },
        },
        select: { id: true, pushSubscription: true },
      });

      await Promise.allSettled(
        reps.map(async (rep) => {
          if (!rep.pushSubscription) return;
          const result = await sendPush(rep.pushSubscription, {
            title: message.title,
            body: message.body,
            url: message.url,
          });
          if (result.outcome === 'invalid') {
            await prisma.user.update({
              where: { id: rep.id },
              data: { pushSubscription: null },
            }).catch(() => {});
          }
        })
      );
    } catch (error) {
      logger.error('[push class reps error]', { error: error instanceof Error ? error.message : error });
    }
  }
}

export const pushNotificationService = new PushNotificationService();
