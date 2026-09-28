import { Prisma } from '@prisma/client';
import { generateQR } from '../../../utils/qrGenerator';
import { exportSubmissions } from '../../../utils/excelExporter';
import { sendPush } from '../../../utils/pushNotifier';
import { AppError, badRequest, forbidden, notFound } from '../../../shared/errors/AppError';
import { submissionRepository, SubmissionRepository } from '../infrastructure/submissionRepository';

const CONFIRM_ALL_MIN_SUBMISSIONS = 90;
const MAX_EXPORT_ROWS = 10_000;

function canManage(user: Express.Request['user'], event: { createdBy: string }): boolean {
  return user!.role === 'dev' || event.createdBy === user!.id;
}

export class SubmissionService {
  constructor(private readonly repository: SubmissionRepository) {}

  async create(input: { eventId?: string; fullName?: string; matricNumber?: string; level?: string }) {
    if (!input.eventId || !input.fullName || !input.matricNumber) {
      throw badRequest('eventId, fullName, and matricNumber are required');
    }

    const fullName = input.fullName.trim();
    const matricNumber = input.matricNumber.trim().toUpperCase();
    const level = input.level?.trim() || null;
    if (!fullName || !matricNumber || fullName.length > 120 || matricNumber.length > 50) {
      throw badRequest('fullName and matricNumber must be valid and reasonably short');
    }

    const event = await this.repository.findEventById(input.eventId);
    if (!event || event.isDeleted) throw notFound('Event not found');
    if (event.isClosed || new Date() > new Date(event.deadline)) throw forbidden('Event is closed or deadline has passed');

    const existing = await this.repository.findByMatricAndEvent(matricNumber, input.eventId);
    if (existing) throw new AppError(409, 'You have already submitted for this event');

    let submission;
    try {
      submission = await this.repository.createPending({ eventId: input.eventId, fullName, matricNumber, level });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'You have already submitted for this event');
      }
      throw error;
    }

    const updated = await this.repository.updateQrCode(submission.id, await generateQR(submission.id));
    this.notifyCreator(event, fullName, matricNumber).catch(() => undefined);
    return { submission: updated };
  }

  async list(eventId: string, query: { page?: string; limit?: string; search?: string }) {
    const page = Math.max(1, parseInt(query.page ?? '') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '') || 50));
    const search = (query.search ?? '').trim();
    const skip = (page - 1) * limit;

    const event = await this.repository.findActiveEventById(eventId);
    if (!event) throw notFound('Event not found');
    const searchWhere: Prisma.SubmissionWhereInput = search.length >= 2
      ? { OR: [{ fullName: { contains: search, mode: Prisma.QueryMode.insensitive } }, { matricNumber: { contains: search, mode: Prisma.QueryMode.insensitive } }] }
      : {};
    const where: Prisma.SubmissionWhereInput = { eventId, ...searchWhere };

    const [submissions, total, confirmedTotal, pendingTotal] = await Promise.all([
      this.repository.findPage({ where, skip, take: limit }),
      this.repository.count(where),
      this.repository.count({ eventId, isConfirmed: true }),
      this.repository.count({ eventId, isConfirmed: false }),
    ]);

    return { submissions, total, confirmedTotal, pendingTotal, page, totalPages: Math.ceil(total / limit), limit };
  }

  async confirm(id: string, user: Express.Request['user']) {
    const submission = await this.repository.findByIdWithEvent(id);
    if (!submission) throw notFound('Submission not found');
    if (!canManage(user, submission.event)) throw forbidden('You are not allowed to confirm this submission');
    return this.repository.confirm(id, user!.name);
  }

  async scanConfirm(submissionId: string | undefined, user: Express.Request['user']) {
    if (!submissionId) throw badRequest('submissionId is required');
    const submission = await this.repository.findByIdWithEvent(submissionId);
    if (!submission) throw notFound('Submission not found');
    if (!canManage(user, submission.event)) throw forbidden('You are not allowed to confirm this submission');
    if (submission.isConfirmed) return { alreadyConfirmed: true, submission };
    return { alreadyConfirmed: false, submission: await this.repository.confirm(submissionId, user!.name) };
  }

  async confirmAll(eventId: string, user: Express.Request['user']) {
    const event = await this.repository.findActiveEventById(eventId);
    if (!event) throw notFound('Event not found');
    if (!canManage(user, event)) throw forbidden('You are not allowed to confirm submissions for this event');

    const [total, pendingTotal] = await Promise.all([
      this.repository.count({ eventId }),
      this.repository.count({ eventId, isConfirmed: false }),
    ]);
    if (total < CONFIRM_ALL_MIN_SUBMISSIONS) {
      throw badRequest(`Confirm all is only available after at least ${CONFIRM_ALL_MIN_SUBMISSIONS} students have submitted.`);
    }
    if (pendingTotal === 0) return { confirmedCount: 0, total, pendingTotal: 0 };
    const result = await this.repository.confirmAll(eventId, user!.name);
    return { confirmedCount: result.count, total, pendingTotal: 0 };
  }

  async status(id: string) {
    const submission = await this.repository.findStatus(id);
    if (!submission) throw notFound('Submission not found');
    return submission;
  }

  async export(eventId: string) {
    const event = await this.repository.findActiveEventById(eventId);
    if (!event) throw notFound('Event not found');
    const total = await this.repository.count({ eventId, isConfirmed: true });
    if (total > MAX_EXPORT_ROWS) throw badRequest(`Export is limited to ${MAX_EXPORT_ROWS} rows. Use filters or contact support.`);
    const submissions = await this.repository.findConfirmedForExport(eventId);
    return exportSubmissions(submissions, event);
  }

  private async notifyCreator(event: { createdBy: string; courseCode: string }, fullName: string, matricNumber: string) {
    const creator = await this.repository.findCreatorPushSubscription(event.createdBy);
    if (creator?.pushSubscription) {
      await sendPush(creator.pushSubscription, {
        title: `New submission – ${event.courseCode}`,
        body: `${fullName} (${matricNumber}) just submitted`,
        url: `/dashboard`,
      });
    }
  }
}

export const submissionService = new SubmissionService(submissionRepository);
