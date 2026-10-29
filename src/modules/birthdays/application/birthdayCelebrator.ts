import logger from '../../../lib/logger';
import { isEmailConfigured, sendBirthdayEmail } from '../../../utils/mailer';
import { isPushConfigured } from '../../../utils/pushNotifier';
import { notificationDeliveryWorker } from '../../announcements/application/notificationDeliveryWorker';
import { birthdaysCelebratedOn, CLASSMATES_HOUR, displayName, greetingName, lagosToday, SELF_PUSH_HOUR } from '../domain/birthdayRules';
import { birthdayRepository, type BirthdayRepository } from '../infrastructure/birthdayRepository';

type Store = Pick<BirthdayRepository, 'onDates' | 'claimCelebration' | 'releaseCelebration' | 'classmateSubscriptions' | 'studentSubscriptions' | 'enqueuePush'>;

export interface CelebratorOptions {
  sendEmail?: typeof sendBirthdayEmail;
  emailEnabled?: () => boolean;
  pushEnabled?: () => boolean;
  deliverNow?: () => void;
}

/**
 * Celebrates today's birthdays (Lagos time):
 *  - from midnight: the birthday email (retried every few minutes if sending fails);
 *  - 7 am: a notification to the birthday person;
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
    const birthdays = await this.store.onDates(birthdaysCelebratedOn(today));
    for (const birthday of birthdays) {
      const { student } = birthday;
      const name = greetingName(student.fullName, birthday.preferredName);

      if (this.emailEnabled() && (await this.store.claimCelebration(student.id, today.year, 'email'))) {
        try {
          await this.sendEmail(name, student.email, birthday.photoUrl);
          logger.info(`[birthdays] birthday email sent to ${student.id}`);
        } catch (error) {
          // Free the slot so the next check (in a few minutes) tries again.
          await this.store.releaseCelebration(student.id, today.year, 'email');
          logger.warn('[birthdays] email failed, will retry', { error: error instanceof Error ? error.message : error });
        }
      }

      if (today.hour >= SELF_PUSH_HOUR && this.pushEnabled() && (await this.store.claimCelebration(student.id, today.year, 'self-push'))) {
        await this.store.enqueuePush(await this.store.studentSubscriptions(student.id), {
          title: `Happy birthday, ${name}! 🎂`,
          body: 'The whole class is celebrating you today. Open NEXIUM for your flowers 💐',
          url: '/student',
          tag: `birthday-self-${student.id}-${today.year}`,
        });
        this.deliverNow();
      }

      if (today.hour >= CLASSMATES_HOUR && birthday.shareWithClass && this.pushEnabled() && (await this.store.claimCelebration(student.id, today.year, 'classmates'))) {
        const shown = displayName(student.fullName, birthday.preferredName);
        const queued = await this.store.enqueuePush(await this.store.classmateSubscriptions([student.id]), {
          title: `🎉 It's ${shown}'s birthday today!`,
          body: `Wish ${shown} a happy birthday 🎂`,
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
