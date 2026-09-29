import type { AnnouncementNotificationPayload } from '../domain/announcementNotification';
import {
  notificationOutboxRepository,
  NotificationOutboxRepository,
} from '../infrastructure/notificationOutboxRepository';
import { isPushConfigured, sendPush } from '../../../utils/pushNotifier';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;
const DEFAULT_INTERVAL_MS = 15_000;

function retryAt(attempts: number): Date {
  const delayMinutes = Math.min(360, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMinutes * 60_000);
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

  constructor(private readonly repository: NotificationOutboxRepository) {}

  async runOnce(): Promise<number> {
    if (this.running || !isPushConfigured()) return 0;
    this.running = true;
    try {
      const rows = await this.repository.claim(BATCH_SIZE);
      await Promise.all(rows.map((row) => this.deliver(row)));
      return rows.length;
    } finally {
      this.running = false;
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

    const result = await sendPush(JSON.stringify({
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime?.getTime() ?? null,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }), notification);

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
  const run = () => notificationDeliveryWorker.runOnce().catch((error) => {
    console.error('[bulletin notifications] delivery cycle failed:', error instanceof Error ? error.message : error);
  });
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
