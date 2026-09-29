import { getVapidPublicKey, isPushConfigured } from '../../../utils/pushNotifier';
import {
  normalizePushEndpoint,
  normalizeStudentPushSubscription,
} from '../domain/studentPushSubscription';
import {
  studentPushSubscriptionRepository,
  StudentPushSubscriptionRepository,
} from '../infrastructure/studentPushSubscriptionRepository';

export class StudentPushSubscriptionService {
  constructor(private readonly repository: StudentPushSubscriptionRepository) {}

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

  async remove(studentId: string, input: unknown) {
    const endpoint = normalizePushEndpoint((input as { endpoint?: unknown } | null)?.endpoint);
    await this.repository.remove(studentId, endpoint);
    return { subscribed: false };
  }
}

export const studentPushSubscriptionService = new StudentPushSubscriptionService(studentPushSubscriptionRepository);
