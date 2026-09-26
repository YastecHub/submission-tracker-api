import { EventType } from '@prisma/client';
import { uniqueSlug } from '../../../utils/slugGenerator';
import { cacheDelete, cacheGet, cacheSet } from '../../../utils/cache';
import { badRequest, forbidden, notFound } from '../../../shared/errors/AppError';
import {
  submissionEventRepository,
  SubmissionEventRepository,
  SubmissionEventWithCount,
} from '../infrastructure/submissionEventRepository';

const EVENT_TYPES: EventType[] = ['assignment', 'attendance', 'lab', 'other'];

function canManage(user: Express.Request['user'], event: { createdBy: string }): boolean {
  return user!.role === 'dev' || event.createdBy === user!.id;
}

function serializeWithStats(event: SubmissionEventWithCount, confirmedCount: number) {
  return {
    ...event,
    totalSubmissions: event._count.submissions,
    confirmedCount,
    pendingCount: event._count.submissions - confirmedCount,
  };
}

export class SubmissionEventService {
  constructor(private readonly repository: SubmissionEventRepository) {}

  async list(query: { page?: string; limit?: string }) {
    const page = Math.max(1, parseInt(query.page ?? '') || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '') || 20));
    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      this.repository.findPage({ skip, take: limit }),
      this.repository.countActive(),
    ]);

    const confirmedGroups = await this.repository.confirmedCountsByEvent(events.map((event) => event.id));

    const confirmedMap = new Map(confirmedGroups.map((group) => [group.eventId, group._count.id]));
    return {
      events: events.map((event) => serializeWithStats(event, confirmedMap.get(event.id) ?? 0)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(input: {
    title?: string;
    courseCode?: string;
    type?: EventType;
    description?: string;
    deadline?: string;
    userId: string;
  }) {
    if (!input.title || !input.courseCode || !input.deadline) {
      throw badRequest('title, courseCode, and deadline are required');
    }

    const title = input.title.trim();
    const courseCode = input.courseCode.trim().toUpperCase();
    const description = input.description?.trim() || null;
    const type = input.type && EVENT_TYPES.includes(input.type) ? input.type : 'assignment';
    const deadline = new Date(input.deadline);

    if (!title || !courseCode || title.length > 150 || courseCode.length > 30) {
      throw badRequest('title and courseCode must be valid and reasonably short');
    }
    if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
      throw badRequest('deadline must be a valid future date');
    }

    return this.repository.create({
      slug: await uniqueSlug(courseCode, title),
      title,
      courseCode,
      type,
      description,
      deadline,
      createdBy: input.userId,
    });
  }

  async getPublicBySlug(slug: string) {
    const cacheKey = `event:slug:${slug}`;
    const cached = cacheGet<object>(cacheKey);
    if (cached) return cached;

    const event = await this.repository.findPublicBySlug(slug);
    if (!event || event.isDeleted) throw notFound('Event not found');

    cacheSet(cacheKey, event, 10_000);
    return event;
  }

  async getById(id: string, user: Express.Request['user']) {
    const event = await this.repository.findActiveById(id);
    if (!event) throw notFound('Event not found');
    if (!canManage(user, event)) throw forbidden('You are not allowed to view this event');

    const confirmedCount = await this.repository.confirmedCount(id);
    return serializeWithStats(event, confirmedCount);
  }

  async toggleClose(id: string, user: Express.Request['user']) {
    const event = await this.repository.findManageableById(id, user);
    if (!event) throw notFound('Event not found or not authorised');

    const updated = await this.repository.updateCloseState(id, !event.isClosed);
    cacheDelete(`event:slug:${event.slug}`);
    return updated;
  }

  async extend(id: string, deadlineInput: string | undefined, user: Express.Request['user']) {
    if (!deadlineInput) throw badRequest('deadline is required');

    const deadline = new Date(deadlineInput);
    if (Number.isNaN(deadline.getTime())) throw badRequest('deadline must be a valid date');
    if (deadline <= new Date()) throw badRequest('deadline must be in the future');

    const event = await this.repository.findManageableById(id, user);
    if (!event) throw notFound('Event not found or not authorised');

    const updated = await this.repository.extend(id, deadline);
    cacheDelete(`event:slug:${event.slug}`);
    return updated;
  }

  async delete(id: string, user: Express.Request['user']) {
    const event = await this.repository.findManageableById(id, user);
    if (!event) throw notFound('Event not found or not authorised');

    await this.repository.softDelete(id);
    cacheDelete(`event:slug:${event.slug}`);
    return { message: 'Event deleted' };
  }
}

export const submissionEventService = new SubmissionEventService(submissionEventRepository);
