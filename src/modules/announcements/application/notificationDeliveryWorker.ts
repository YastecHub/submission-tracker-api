import type { AnnouncementNotificationPayload } from '../domain/announcementNotification';
import {
  notificationOutboxRepository,
  NotificationOutboxRepository,
} from '../infrastructure/notificationOutboxRepository';
import { isPushConfigured, sendPush, type PushSendResult } from '../../../utils/pushNotifier';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const DEFAULT_INTERVAL_MS = 15_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000; // 1 hour

export function retryAt(attempts: number): Date {
  const baseDelayMinutes = Math.min(360, 2 ** Math.max(0, attempts - 1));
  const jitterFactor = 0.8 + Math.random() * 0.4; // 80% to 120% jitter
  const delayMinutes = baseDelayMinutes * jitterFactor;
  return new Date(Date.now() + Math.round(delayMinutes * 60_000));
}

function payload(value: unknown): AnnouncementNotificationPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Partial<AnnouncementNotificationPayload>;
  if (typeof input.title !== 'string' || typeof input.body !== 'string' || typeof input.url !== 'string' || typeof input.tag !== 'string') {
    return null;
  }
  return input as AnnouncementNotificationPayload;
}

export class NotificationDeliveryWorker {
  private running = false;

  constructor(
    private readonly repository: NotificationOutboxRepository,
    private readonly pushSender: (subscription: string, payload: AnnouncementNotificationPayload) => Promise<PushSendResult> = sendPush,
  ) {}

  async runOnce(): Promise<number> {
    if (this.running || !isPushConfigured()) return 0;
    this.running = true;
    try {
      const rows = await this.repository.claim(BATCH_SIZE);
      await Promise.all(
        rows.map(async (row) => {
          try {
            await this.deliver(row);
          } catch (error) {
            console.error(
              `[bulletin delivery] worker error for outbox row ${row.id}:`,
              error instanceof Error ? error.message : error,
            );
          }
        }),
      );
      return rows.length;
    } finally {
      this.running = false;
    }
  }

  async cleanup(retentionDays?: number) {
    try {
      return await this.repository.cleanupInvalidSubscriptions(retentionDays);
    } catch (error) {
      console.error('[bulletin notifications] cleanup failed:', error instanceof Error ? error.message : error);
      return { removedSubscriptions: 0, prunedOutboxRows: 0 };
    }
  }

  private async deliver(row: { id: string; subscriptionId: string | null; payload: unknown; attempts: number }) {
    const notification = payload(row.payload);
    if (!notification || !row.subscriptionId) {
      await this.repository.dead(row.id, 'Notification data is unavailable');
      return;
    }

    const subscription = await this.repository.findSubscription(row.subscriptionId);
    if (!subscription || (subscription.expirationTime && subscription.expirationTime <= new Date())) {
      await this.repository.invalidateSubscription(row.subscriptionId, 'Notification subscription expired');
      return;
    }

    const result = await this.pushSender(
      JSON.stringify({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime?.getTime() ?? null,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }),
      notification,
    );

    if (result.outcome === 'delivered') {
      await this.repository.complete(row.id);
    } else if (result.outcome === 'invalid') {
      await this.repository.invalidateSubscription(row.subscriptionId, result.message);
    } else if (result.outcome === 'retry' && row.attempts < MAX_ATTEMPTS) {
      await this.repository.retry(row.id, retryAt(row.attempts), result.message);
    } else {
      await this.repository.dead(row.id, result.message);
    }
  }
}

export const notificationDeliveryWorker = new NotificationDeliveryWorker(notificationOutboxRepository);

export function startNotificationDeliveryWorker(): () => void {
  if (!isPushConfigured()) {
    console.warn('[bulletin notifications] VAPID is not configured; delivery worker is disabled.');
    return () => {};
  }
  const configured = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS);
  const intervalMs = Number.isFinite(configured) && configured >= 5_000 ? configured : DEFAULT_INTERVAL_MS;

  const run = () =>
    notificationDeliveryWorker.runOnce().catch((error) => {
      console.error('[bulletin notifications] delivery cycle failed:', error instanceof Error ? error.message : error);
    });

  const runCleanup = () =>
    notificationDeliveryWorker.cleanup().catch((error) => {
      console.error('[bulletin notifications] periodic cleanup failed:', error instanceof Error ? error.message : error);
    });

  const initialTimer = setTimeout(run, 2_000);
  initialTimer.unref();

  const initialCleanupTimer = setTimeout(runCleanup, 60_000);
  initialCleanupTimer.unref();

  const timer = setInterval(run, intervalMs);
  timer.unref();

  const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  return () => {
    clearTimeout(initialTimer);
    clearTimeout(initialCleanupTimer);
    clearInterval(timer);
    clearInterval(cleanupTimer);
  };
}
