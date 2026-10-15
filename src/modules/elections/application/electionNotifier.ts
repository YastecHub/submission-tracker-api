import logger from '../../../lib/logger';
import { isEmailConfigured, sendElectionOpenEmail } from '../../../utils/mailer';
import { isPushConfigured } from '../../../utils/pushNotifier';
import { notificationDeliveryWorker } from '../../announcements/application/notificationDeliveryWorker';
import { dueNotices, lagosTime, noticeMessage, type Notice } from '../domain/electionNotices';
import {
  electionNotificationRepository,
  type ElectionNotificationRepository,
  type NoticeRecipient,
  type NotifiableElection,
} from '../infrastructure/electionNotificationRepository';

type NoticeStore = Pick<ElectionNotificationRepository, 'activeElections' | 'claim' | 'recipients' | 'enqueuePush' | 'record' | 'history' | 'lastReminderAt'>;
type EmailSender = typeof sendElectionOpenEmail;

export interface NotifierOptions {
  pushEnabled?: () => boolean;
  emailEnabled?: () => boolean;
  sendEmail?: EmailSender;
  /** Starts push delivery right away instead of waiting for the worker's next cycle. */
  deliverNow?: () => void;
  /** Most "voting is open" emails per election (Resend's free plan allows about 100 a day). */
  emailCap?: number;
  /** Pause between emails (Resend's free plan allows 2 a second). */
  emailGapMs?: number;
}

function configuredEmailCap(): number {
  const value = Number(process.env.ELECTION_EMAIL_CAP);
  return Number.isInteger(value) && value >= 0 ? value : 80;
}

/** Runs the delivery worker until the queue is empty (it skips if a cycle is already running). */
async function deliverQueuedPush() {
  for (let round = 0; round < 40; round += 1) {
    if ((await notificationDeliveryWorker.runOnce()) === 0) return;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends election notices: push to every phone of the students in the audience, and for
 * "voting is open" an email to students without push (capped). Each notice goes out once.
 */
export class ElectionNotifier {
  /** Notices this server already handled, so the 5-second schedule doesn't ask the database each time. */
  private readonly handled = new Set<string>();
  private readonly pushEnabled: () => boolean;
  private readonly emailEnabled: () => boolean;
  private readonly sendEmail: EmailSender;
  private readonly deliverNow: () => void;
  private readonly emailCap: number;
  private readonly emailGapMs: number;

  constructor(private readonly store: NoticeStore = electionNotificationRepository, options: NotifierOptions = {}) {
    this.pushEnabled = options.pushEnabled ?? isPushConfigured;
    this.emailEnabled = options.emailEnabled ?? isEmailConfigured;
    this.sendEmail = options.sendEmail ?? sendElectionOpenEmail;
    this.deliverNow = options.deliverNow ?? (() => { deliverQueuedPush().catch((error) => logger.warn('[elections] push delivery failed', { error })); });
    this.emailCap = options.emailCap ?? configuredEmailCap();
    this.emailGapMs = options.emailGapMs ?? 600;
  }

  /** Called by the election schedule every few seconds. */
  async runDue(now: Date = new Date()): Promise<void> {
    const elections = await this.store.activeElections(now);
    for (const election of elections) {
      for (const notice of dueNotices(election, now)) {
        if (this.handled.has(`${election.id}:${notice.key}`)) continue;
        await this.send(election, notice, null);
      }
    }
  }

  /** Sends one notice. Returns null if it had already been sent. */
  async send(election: NotifiableElection, notice: Notice, sentByName: string | null): Promise<{ pushQueued: number; emailTargets: number } | null> {
    const claimed = await this.store.claim(election.id, notice, sentByName);
    this.handled.add(`${election.id}:${notice.key}`);
    if (!claimed) return null;

    const recipients = await this.store.recipients(election.id, notice.audience, election.registrationDeadline);
    const subscriptionIds = this.pushEnabled() ? recipients.flatMap((recipient) => recipient.subscriptionIds) : [];
    if (subscriptionIds.length) {
      await this.store.enqueuePush(subscriptionIds, noticeMessage(notice.kind, election));
      await this.store.record(claimed.id, { pushQueued: subscriptionIds.length });
      this.deliverNow();
    }

    const withoutPush = recipients.filter((recipient) => !recipient.subscriptionIds.length || !this.pushEnabled());
    const emailTargets = notice.email && this.emailEnabled() ? withoutPush.slice(0, this.emailCap) : [];
    if (emailTargets.length) {
      this.emailBackup(claimed.id, election, emailTargets).catch((error) => logger.warn('[elections] email backup failed', { error }));
    }
    logger.info(`[elections] notice "${notice.kind}" for ${election.id}: ${subscriptionIds.length} phones, ${emailTargets.length} emails queued`);
    return { pushQueued: subscriptionIds.length, emailTargets: emailTargets.length };
  }

  /** Sends the emails one by one (rate limit) and keeps the sent count up to date. */
  async emailBackup(noticeId: string, election: NotifiableElection, recipients: NoticeRecipient[]): Promise<number> {
    const details = { title: election.title, closesAtText: lagosTime(election.closesAt), path: `/student/elections/${election.id}` };
    let sent = 0;
    for (const recipient of recipients) {
      try {
        await this.sendEmail(recipient.fullName, recipient.email, details);
        sent += 1;
      } catch (error) {
        logger.warn('[elections] voting-open email failed', { error: error instanceof Error ? error.message : error });
        if (error instanceof Error && /quota|daily/i.test(error.message)) break; // out of emails for today
      }
      if (sent % 10 === 0) await this.store.record(noticeId, { emailsSent: sent });
      if (this.emailGapMs) await wait(this.emailGapMs);
    }
    await this.store.record(noticeId, { emailsSent: sent });
    return sent;
  }

  history(electionId: string) {
    return this.store.history(electionId);
  }

  lastReminderAt(electionId: string) {
    return this.store.lastReminderAt(electionId);
  }
}

export const electionNotifier = new ElectionNotifier();
