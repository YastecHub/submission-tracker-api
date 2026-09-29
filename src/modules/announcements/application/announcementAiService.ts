import { createHash } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import { AppError, badRequest, forbidden, notFound } from '../../../shared/errors/AppError';
import { canEditAnnouncement } from '../domain/announcementPolicy';
import { InvalidAiOrganizationError, normalizeAiOrganization } from '../domain/announcementAiOutput';
import { announcementRepository, AnnouncementRepository } from '../infrastructure/announcementRepository';
import {
  AnnouncementOrganizer,
  AnnouncementOrganizerError,
  BULLETIN_AI_PROMPT_VERSION,
  configuredAnnouncementOrganizer,
} from '../infrastructure/announcementOrganizer';
import {
  announcementAiRunRepository,
  AnnouncementAiRunRepository,
} from '../infrastructure/announcementAiRunRepository';

type StaffUser = NonNullable<Express.Request['user']>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sourceText(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('Paste source material before asking for help');
  const source = value.trim();
  if (source.length < 20) throw badRequest('Add a little more source material before asking for help');
  // AI organizer temporarily unavailable: gpt-oss-20b model on Groq has insufficient context window.
  throw badRequest('The announcement assistant is currently unavailable. Please organize your announcement manually using the Composer.');
  // Original validation (for when a working model is configured):
  // if (source.length > 1_000) throw badRequest('Source material is too long for the AI organizer (max ~1,000 characters). Please shorten or organize manually using the Composer.');
  return source;
}

function optionalAnnouncementId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw badRequest('The announcement reference is invalid');
  return value;
}

function sourceHash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

export class AnnouncementAiService {
  constructor(
    private readonly runs: AnnouncementAiRunRepository,
    private readonly announcements: AnnouncementRepository,
    private readonly organizerFactory: () => AnnouncementOrganizer,
  ) {}

  async organize(input: unknown, user: StaffUser) {
    const request = input && typeof input === 'object' && !Array.isArray(input)
      ? input as { rawSource?: unknown; announcementId?: unknown }
      : {};
    const rawSource = sourceText(request.rawSource);
    const announcementId = optionalAnnouncementId(request.announcementId);

    if (announcementId) {
      const announcement = await this.announcements.findForAction(announcementId);
      if (!announcement) throw notFound('Announcement not found');
      if (!canEditAnnouncement({ id: user.id, role: user.role as UserRole }, announcement)) {
        throw forbidden('You are not allowed to edit this announcement');
      }
    }

    let organizer: AnnouncementOrganizer;
    try {
      organizer = this.organizerFactory();
    } catch (error) {
      if (error instanceof AnnouncementOrganizerError && error.code === 'not_configured') {
        throw new AppError(503, 'The announcement assistant is not configured yet');
      }
      throw error;
    }

    const startedAt = Date.now();
    const auditBase = {
      announcementId,
      requestedBy: user.id,
      provider: organizer.provider,
      model: organizer.model,
      promptVersion: BULLETIN_AI_PROMPT_VERSION,
      sourceHash: sourceHash(rawSource),
      sourceLength: rawSource.length,
    };

    try {
      const rawResult = await organizer.organize(rawSource);
      const suggestion = normalizeAiOrganization(rawResult, rawSource);
      const run = await this.runs.createCompleted({
        ...auditBase,
        result: suggestion as unknown as Prisma.InputJsonValue,
        latencyMs: Date.now() - startedAt,
      });
      return {
        runId: run.id,
        suggestion,
        audit: {
          provider: run.provider,
          model: run.model,
          promptVersion: run.promptVersion,
          createdAt: run.createdAt,
        },
      };
    } catch (error) {
      const errorCode = error instanceof AnnouncementOrganizerError || error instanceof InvalidAiOrganizationError
        ? error.code
        : 'unexpected_failure';
      console.error(`[bulletin assistant] organize error [${errorCode}]:`, error);
      try {
        await this.runs.createFailed({ ...auditBase, latencyMs: Date.now() - startedAt, errorCode });
      } catch {
        console.error('[bulletin assistant] failed to save run metadata');
      }
      throw new AppError(502, 'The announcement assistant could not organize this source. Your source material is unchanged.');
    }
  }
}

export const announcementAiService = new AnnouncementAiService(
  announcementAiRunRepository,
  announcementRepository,
  configuredAnnouncementOrganizer,
);
