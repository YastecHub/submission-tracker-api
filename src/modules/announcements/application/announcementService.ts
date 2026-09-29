import { createHash } from 'node:crypto';
import {
  AnnouncementCategory,
  AnnouncementPriority,
  AnnouncementSourceType,
  AnnouncementStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { uniqueAnnouncementSlug } from '../../../utils/slugGenerator';
import { AppError, badRequest, forbidden, notFound } from '../../../shared/errors/AppError';
import { normalizeAnnouncementDocument } from '../domain/announcementContent';
import type { AiOrganizationResult } from '../domain/announcementAiOutput';
import { canEditAnnouncement, canPublishAnnouncement } from '../domain/announcementPolicy';
import {
  announcementRepository,
  AnnouncementAiAcceptance,
  AnnouncementAiAcceptanceConflictError,
  AnnouncementRepository,
  AnnouncementWriteData,
} from '../infrastructure/announcementRepository';
import {
  announcementAiRunRepository,
  AnnouncementAiRunRepository,
} from '../infrastructure/announcementAiRunRepository';

const CATEGORIES: AnnouncementCategory[] = ['general', 'academic', 'practical', 'finance', 'event', 'opportunity', 'emergency'];
const PRIORITIES: AnnouncementPriority[] = ['normal', 'important', 'urgent'];
const STATUSES: AnnouncementStatus[] = ['draft', 'published', 'archived'];
const SOURCE_TYPES: AnnouncementSourceType[] = [
  'official_class',
  'educational_contribution',
  'lecturer_information',
  'external_information',
];

type StaffUser = NonNullable<Express.Request['user']>;

interface WriteInput {
  title?: unknown;
  summary?: unknown;
  content?: unknown;
  rawSource?: unknown;
  category?: unknown;
  priority?: unknown;
  sourceType?: unknown;
  contributorName?: unknown;
  contributorCredit?: unknown;
  isPinned?: unknown;
  requiresAcknowledgement?: unknown;
  paymentEventId?: unknown;
  expectedVersion?: unknown;
  changeNote?: unknown;
  aiReview?: unknown;
}

interface AiReview {
  runId: string;
  acceptedFields: Array<'title' | 'summary' | 'category' | 'priority' | 'sections'>;
  acceptedSectionIds: string[];
}

const AI_REVIEW_FIELDS = ['title', 'summary', 'category', 'priority', 'sections'] as const;
const SECTION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, label: string): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw badRequest(`${label} is invalid`);
  return value as T;
}

function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${label} is invalid`);
  const normalized = value.trim();
  if (normalized.length > max) throw badRequest(`${label} is too long`);
  return normalized || null;
}

function expectedVersion(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw badRequest('The announcement version is invalid');
  return parsed;
}

function toWriteData(input: WriteInput): AnnouncementWriteData {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  if (!title || title.length > 180) throw badRequest('Title is required and must be 180 characters or less');
  if (!summary || summary.length > 500) throw badRequest('Summary is required and must be 500 characters or less');

  const category = oneOf(input.category, CATEGORIES, 'general', 'Category');
  const paymentEventId = optionalText(input.paymentEventId, 100, 'Related payment');
  if (paymentEventId && category !== 'finance') {
    throw badRequest('A related payment can only be attached to a finance announcement');
  }

  return {
    title,
    summary,
    content: normalizeAnnouncementDocument(input.content) as unknown as Prisma.InputJsonValue,
    rawSource: optionalText(input.rawSource, 50_000, 'Raw source'),
    category,
    priority: oneOf(input.priority, PRIORITIES, 'normal', 'Priority'),
    sourceType: oneOf(input.sourceType, SOURCE_TYPES, 'official_class', 'Source type'),
    contributorName: optionalText(input.contributorName, 150, 'Contributor name'),
    contributorCredit: optionalText(input.contributorCredit, 240, 'Contributor credit'),
    isPinned: input.isPinned === true,
    requiresAcknowledgement: input.requiresAcknowledgement === true,
    paymentEventId,
  };
}

function cleanSearch(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const search = value.trim();
  if (search.length > 100) throw badRequest('Search is too long');
  return search || undefined;
}

function aiReview(value: unknown): AiReview | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('The assistant review record is invalid');
  const input = value as { runId?: unknown; acceptedFields?: unknown; acceptedSectionIds?: unknown };
  if (typeof input.runId !== 'string' || !UUID_PATTERN.test(input.runId)) throw badRequest('The assistant review record is invalid');
  if (!Array.isArray(input.acceptedFields) || input.acceptedFields.length < 1 || input.acceptedFields.length > AI_REVIEW_FIELDS.length) {
    throw badRequest('Choose at least one assistant suggestion before saving');
  }
  const acceptedFields = Array.from(new Set(input.acceptedFields.map((field) => {
    if (typeof field !== 'string' || !AI_REVIEW_FIELDS.includes(field as typeof AI_REVIEW_FIELDS[number])) {
      throw badRequest('The assistant review selection is invalid');
    }
    return field as AiReview['acceptedFields'][number];
  })));
  if (!Array.isArray(input.acceptedSectionIds) || input.acceptedSectionIds.length > 20) {
    throw badRequest('The assistant section selection is invalid');
  }
  const acceptedSectionIds = Array.from(new Set(input.acceptedSectionIds.map((id) => {
    if (typeof id !== 'string' || !SECTION_ID_PATTERN.test(id)) throw badRequest('The assistant section selection is invalid');
    return id;
  })));
  if (acceptedFields.includes('sections') && acceptedSectionIds.length === 0) {
    throw badRequest('Choose at least one assistant section before saving');
  }
  return { runId: input.runId, acceptedFields, acceptedSectionIds };
}

function hashSource(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pageValues(pageInput: unknown, limitInput: unknown) {
  const page = Math.max(1, parseInt(String(pageInput ?? '')) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(limitInput ?? '')) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export class AnnouncementService {
  constructor(
    private readonly repository: AnnouncementRepository,
    private readonly aiRuns: AnnouncementAiRunRepository,
  ) {}

  async listAdmin(query: Record<string, unknown>) {
    const { page, limit, skip } = pageValues(query.page, query.limit);
    const status = query.status ? oneOf(query.status, STATUSES, 'draft', 'Status') : undefined;
    const category = query.category ? oneOf(query.category, CATEGORIES, 'general', 'Category') : undefined;
    const [announcements, total] = await this.repository.findAdminPage({
      skip,
      take: limit,
      status,
      category,
      search: cleanSearch(query.search),
    });
    return {
      announcements: announcements.map(({ _count, ...announcement }) => ({
        ...announcement,
        readCount: _count.reads,
      })),
      page,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAdmin(id: string) {
    const announcement = await this.repository.findAdminById(id);
    if (!announcement) throw notFound('Announcement not found');
    const { _count, ...data } = announcement;
    return { ...data, readCount: _count.reads };
  }

  async create(input: WriteInput, user: StaffUser) {
    const data = toWriteData(input);
    const review = aiReview(input.aiReview);
    await this.validateAiReview(review, data, user.id, null);
    await this.validatePayment(data.paymentEventId);
    try {
      return await this.repository.create({
        data: {
          ...data,
          slug: await uniqueAnnouncementSlug(data.title),
          createdBy: user.id,
          updatedBy: user.id,
        },
        aiAcceptance: this.aiAcceptance(review, user.id),
      });
    } catch (error) {
      this.rethrowAiAcceptanceConflict(error);
    }
  }

  async update(id: string, input: WriteInput, user: StaffUser) {
    const current = await this.repository.findForAction(id);
    if (!current) throw notFound('Announcement not found');
    if (!canEditAnnouncement({ id: user.id, role: user.role as UserRole }, current)) {
      throw forbidden('You are not allowed to edit this announcement');
    }

    const data = toWriteData(input);
    const review = aiReview(input.aiReview);
    await this.validateAiReview(review, data, user.id, id);
    if (current.status !== 'draft' && !canPublishAnnouncement(user.role as UserRole, data.category)) {
      throw forbidden('You are not allowed to publish changes to this announcement');
    }
    await this.validatePayment(data.paymentEventId);

    try {
      const updated = await this.repository.updateWithVersion({
        id,
        expectedVersion: expectedVersion(input.expectedVersion),
        data: { ...data, updatedBy: user.id },
        createRevision: current.status === 'published',
        changeNote: optionalText(input.changeNote, 300, 'Change note'),
        origin: review ? 'ai_assisted' : 'manual',
        aiAcceptance: this.aiAcceptance(review, user.id),
      });
      if (!updated) throw new AppError(409, 'This announcement was changed elsewhere. Reload it before saving again.');
      return updated;
    } catch (error) {
      this.rethrowAiAcceptanceConflict(error);
    }
  }

  async publish(id: string, input: { expectedVersion?: unknown; changeNote?: unknown }, user: StaffUser) {
    const current = await this.repository.findForAction(id);
    if (!current) throw notFound('Announcement not found');
    if (current.status !== 'draft') throw badRequest('Only draft announcements can be published');
    if (!canPublishAnnouncement(user.role as UserRole, current.category)) {
      throw forbidden(current.category === 'finance'
        ? 'Only the Financial Secretary can publish finance announcements'
        : 'Only the Class Representative can publish this announcement');
    }

    const published = await this.repository.publishWithVersion(
      id,
      expectedVersion(input.expectedVersion),
      user.id,
      optionalText(input.changeNote, 300, 'Change note'),
    );
    if (!published) throw new AppError(409, 'This announcement changed before it could be published. Reload and review it again.');
    return published;
  }

  async archive(id: string, input: { expectedVersion?: unknown }, user: StaffUser) {
    const current = await this.repository.findForAction(id);
    if (!current) throw notFound('Announcement not found');
    if (current.status !== 'published') throw badRequest('Only published announcements can be archived');
    if (!canPublishAnnouncement(user.role as UserRole, current.category)) {
      throw forbidden('You are not allowed to archive this announcement');
    }
    const archived = await this.repository.archiveWithVersion(id, expectedVersion(input.expectedVersion), user.id);
    if (!archived) throw new AppError(409, 'This announcement changed before it could be archived. Reload and try again.');
    return archived;
  }

  paymentOptions() {
    return this.repository.paymentOptions();
  }

  async listFeed(query: Record<string, unknown>, studentId: string) {
    const { page, limit, skip } = pageValues(query.page, query.limit);
    const category = query.category ? oneOf(query.category, CATEGORIES, 'general', 'Category') : undefined;
    const priority = query.priority ? oneOf(query.priority, PRIORITIES, 'normal', 'Priority') : undefined;
    const [announcements, total] = await this.repository.findStudentFeed({
      studentId,
      skip,
      take: limit,
      category,
      priority,
      search: cleanSearch(query.search),
    });
    return {
      announcements: announcements.map(({ reads, ...announcement }) => ({
        ...announcement,
        isUnread: !reads[0] || reads[0].lastReadVersion < announcement.version,
        isAcknowledged: !!reads[0]?.acknowledgedVersion && reads[0].acknowledgedVersion >= announcement.version,
      })),
      page,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPublished(slug: string, studentId: string) {
    const announcement = await this.repository.findPublishedBySlug(slug, studentId);
    if (!announcement) throw notFound('Announcement not found');
    const { reads, paymentEvent, ...data } = announcement;
    return {
      ...data,
      paymentEvent: paymentEvent?.isDeleted ? null : paymentEvent,
      isUnread: !reads[0] || reads[0].lastReadVersion < announcement.version,
      isAcknowledged: !!reads[0]?.acknowledgedVersion && reads[0].acknowledgedVersion >= announcement.version,
    };
  }

  unreadCount(studentId: string) {
    return this.repository.unreadCount(studentId).then((count) => ({ count }));
  }

  async markRead(id: string, studentId: string) {
    const result = await this.repository.markRead(id, studentId);
    if (!result) throw notFound('Announcement not found');
    return result;
  }

  async acknowledge(id: string, studentId: string) {
    const result = await this.repository.acknowledge(id, studentId);
    if (!result) throw notFound('Announcement not found or does not require acknowledgement');
    return result;
  }

  async getAnalytics(id: string) {
    const result = await this.repository.getAnalytics(id);
    if (!result) throw notFound('Announcement not found');
    return result;
  }

  async getOutstandingStudents(id: string, query: { page?: unknown; limit?: unknown; search?: unknown }) {
    const { page, limit, skip } = pageValues(query.page, query.limit);
    const search = cleanSearch(query.search);
    const result = await this.repository.getOutstandingStudents(id, { skip, take: limit, search });
    if (!result) throw notFound('Announcement not found or does not require acknowledgement');
    return {
      ...result,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  private async validatePayment(paymentEventId: string | null) {
    if (paymentEventId && !(await this.repository.findPaymentOption(paymentEventId))) {
      throw badRequest('The related payment could not be found');
    }
  }

  private async validateAiReview(review: AiReview | null, data: AnnouncementWriteData, userId: string, announcementId: string | null) {
    if (!review) return;
    if (!data.rawSource) throw badRequest('Keep the reviewed source material before saving assistant suggestions');
    const run = await this.aiRuns.findOwnedCompleted(review.runId, userId);
    if (!run || (run.announcementId && run.announcementId !== announcementId)) {
      throw badRequest('The assistant review could not be verified. Request a new suggestion.');
    }
    if (run.sourceHash !== hashSource(data.rawSource)) {
      throw badRequest('The source material changed after the suggestion. Request a new suggestion before saving it.');
    }

    const suggestion = run.result as unknown as AiOrganizationResult | null;
    if (!suggestion) throw badRequest('The assistant review could not be verified. Request a new suggestion.');
    if (review.acceptedFields.includes('title') && data.title !== suggestion.title.value) this.throwChangedSuggestion();
    if (review.acceptedFields.includes('summary') && data.summary !== suggestion.summary.value) this.throwChangedSuggestion();
    if (review.acceptedFields.includes('category') && data.category !== suggestion.category.value) this.throwChangedSuggestion();
    if (review.acceptedFields.includes('priority') && data.priority !== suggestion.priority.value) this.throwChangedSuggestion();
    if (review.acceptedFields.includes('sections')) {
      const content = data.content as unknown as { sections?: Array<{ id?: unknown; heading?: unknown; body?: unknown }> };
      const savedSections = new Map((content.sections ?? []).map((section) => [section.id, section]));
      const suggestedSections = new Map(suggestion.sections.map((section) => [section.id, section]));
      for (const id of review.acceptedSectionIds) {
        const saved = savedSections.get(id);
        const suggested = suggestedSections.get(id);
        if (!saved || !suggested || saved.heading !== suggested.heading || saved.body !== suggested.body) this.throwChangedSuggestion();
      }
    }
  }

  private throwChangedSuggestion(): never {
    throw badRequest('An accepted assistant suggestion was changed. Review the edited draft and save it as a manual change.');
  }

  private aiAcceptance(review: AiReview | null, userId: string): AnnouncementAiAcceptance | null {
    if (!review) return null;
    return {
      runId: review.runId,
      requestedBy: userId,
      acceptedFields: {
        fields: review.acceptedFields,
        sectionIds: review.acceptedSectionIds,
      },
    };
  }

  private rethrowAiAcceptanceConflict(error: unknown): never {
    if (error instanceof AnnouncementAiAcceptanceConflictError) {
      throw badRequest('This assistant suggestion was already used or changed. Request a new suggestion before saving.');
    }
    throw error;
  }
}

export const announcementService = new AnnouncementService(announcementRepository, announcementAiRunRepository);
