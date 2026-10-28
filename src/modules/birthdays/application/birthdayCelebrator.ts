import logger from '../../../lib/logger';
import { isEmailConfigured, sendBirthdayEmail } from '../../../utils/mailer';
import { isPushConfigured } from '../../../utils/pushNotifier';
import { notificationDeliveryWorker } from '../../announcements/application/notificationDeliveryWorker';
import { birthdaysCelebratedOn, CLASSMATES_HOUR, displayName, EMAIL_HOUR, greetingName, lagosToday } from '../domain/birthdayRules';
import { birthdayRepository, type BirthdayRepository } from '../infrastructure/birthdayRepository';

type Store = Pick<BirthdayRepository, 'onDates' | 'claimCelebration' | 'classmateSubscriptions' | 'studentSubscriptions' | 'enqueuePush'>;

export interface CelebratorOptions {
  sendEmail?: typeof sendBirthdayEmail;
  emailEnabled?: () => boolean;
  pushEnabled?: () => boolean;
  deliverNow?: () => void;
}

/**
 * Celebrates today's birthdays (Lagos time):
 *  - 7 am: a birthday email and a notification to the birthday person;
 *  - 8 am: a notification to classmates, only if the birthday person agreed to share it.
 * Each is recorded once per year, so restarts and several servers never send twice.
 * If the server starts later in the day, today's celebrations still go out.
 */
export class BirthdayCelebrator {
  private readonly sendEmail: typeof sendBirthdayEmail;
  private readonly emailEnabled: () => boolean;
  private readonly pushEnabled: () => boolean;
  private readonly deliverNow: () => void;

  constructor(private readonly store: Store = birthdayRepository, options: CelebratorOptions = {}) {
    this.sendEmail = options.sendEmail ?? sendBirthdayEmail;
    this.emailEnabled = options.emailEnabled ?? isEmailConfigured;
    this.pushEnabled = options.pushEnabled ?? isPushConfigured;
    this.deliverNow = options.deliverNow ?? (() => { void notificationDeliveryWorker.runOnce().catch(() => undefined); });
  }

  async runDue(now: Date = new Date()): Promise<void> {
    const today = lagosToday(now);
    if (today.hour < EMAIL_HOUR) return;
    const birthdays = await this.store.onDates(birthdaysCelebratedOn(today));
    for (const birthday of birthdays) {
      const { student } = birthday;
      if (await this.store.claimCelebration(student.id, today.year, 'email')) {
        const name = greetingName(student.fullName, birthday.preferredName);
        if (this.pushEnabled()) {
          await this.store.enqueuePush(await this.store.studentSubscriptions(student.id), {
            title: `Happy birthday, ${name}! 🎂`,
            body: 'The whole class is celebrating you today. Open NEXIUM for your flowers 💐',
            url: '/student',
            tag: `birthday-self-${student.id}-${today.year}`,
          });
          this.deliverNow();
        }
        if (this.emailEnabled()) {
          await this.sendEmail(name, student.email).catch((error) => logger.warn('[birthdays] email failed', { error: error instanceof Error ? error.message : error }));
        }
      }
      if (today.hour >= CLASSMATES_HOUR && birthday.shareWithClass && (await this.store.claimCelebration(student.id, today.year, 'classmates'))) {
        if (!this.pushEnabled()) continue;
        const name = displayName(student.fullName, birthday.preferredName);
        const queued = await this.store.enqueuePush(await this.store.classmateSubscriptions([student.id]), {
          title: `🎉 It's ${name}'s birthday today!`,
          body: `Wish ${name} a happy birthday 🎂`,
          url: '/student',
          tag: `birthday-${student.id}-${today.year}`,
        });
        this.deliverNow();
        logger.info(`[birthdays] told ${queued} classmate devices about ${student.id}'s birthday`);
      }
    }
  }
}

export const birthdayCelebrator = new BirthdayCelebrator();

/** Checks every 5 minutes; cheap, because each celebration is recorded once a year. */
export function startBirthdayScheduler(intervalMs = 5 * 60_000): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    birthdayCelebrator.runDue()
      .catch((error) => logger.warn('[birthdays] celebration check failed', { error }))
      .finally(() => { running = false; });
  };
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
