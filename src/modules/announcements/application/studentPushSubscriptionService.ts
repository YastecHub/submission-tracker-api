import { AppError } from '../../../shared/errors/AppError';
import { getVapidPublicKey, isPushConfigured, sendPush } from '../../../utils/pushNotifier';
import {
  normalizePushEndpoint,
  normalizeStudentPushSubscription,
} from '../domain/studentPushSubscription';
import {
  studentPushSubscriptionRepository,
  StudentPushSubscriptionRepository,
} from '../infrastructure/studentPushSubscriptionRepository';

/** Sent when a student turns notifications on, or taps "Send a test notification". */
export const TEST_NOTIFICATION = {
  title: 'NEXIUM notifications are on',
  body: "You'll get updates like this one, for example when voting opens.",
  url: '/student',
  tag: 'nexium-test',
};

export class StudentPushSubscriptionService {
  constructor(
    private readonly repository: StudentPushSubscriptionRepository,
    private readonly push: typeof sendPush = sendPush,
    private readonly pushConfigured: () => boolean = isPushConfigured,
  ) {}

  config() {
    return { configured: isPushConfigured(), publicKey: getVapidPublicKey() };
  }

  async status(studentId: string, input: unknown) {
    const endpoint = normalizePushEndpoint((input as { endpoint?: unknown } | null)?.endpoint);
    return { subscribed: await this.repository.isOwned(studentId, endpoint) };
  }

  async save(studentId: string, input: unknown, userAgent?: string) {
    const subscription = normalizeStudentPushSubscription(
      (input as { subscription?: unknown } | null)?.subscription,
    );
    await this.repository.save(studentId, subscription, userAgent?.slice(0, 500) || null);
    return { subscribed: true };
  }

  /** Sends a notification straight to this device (not through the queue), so the student sees it at once. */
  async sendTest(studentId: string, input: unknown) {
    if (!this.pushConfigured()) throw new AppError(503, "Notifications aren't switched on for NEXIUM yet. Please tell the class rep.");
    const endpoint = normalizePushEndpoint((input as { endpoint?: unknown } | null)?.endpoint);
    const subscription = await this.repository.findOwned(studentId, endpoint);
    if (!subscription) throw new AppError(404, 'Notifications are not on for this device yet. Turn them on first.');
    const result = await this.push(
      JSON.stringify({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime?.getTime() ?? null,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }),
      TEST_NOTIFICATION,
    );
    if (result.outcome === 'delivered') return { sent: true };
    if (result.outcome === 'invalid') {
      await this.repository.remove(studentId, endpoint);
      throw new AppError(410, 'This device stopped accepting notifications. Turn them on again.');
    }
    throw new AppError(502, "Your phone's notification service didn't answer. Try again in a minute.");
  }

  async remove(studentId: string, input: unknown) {
    const endpoint = normalizePushEndpoint((input as { endpoint?: unknown } | null)?.endpoint);
    await this.repository.remove(studentId, endpoint);
    return { subscribed: false };
  }
}

export const studentPushSubscriptionService = new StudentPushSubscriptionService(studentPushSubscriptionRepository);
