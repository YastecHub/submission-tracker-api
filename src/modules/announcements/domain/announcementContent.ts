import { randomUUID } from 'node:crypto';
import { badRequest } from '../../../shared/errors/AppError';

export interface AnnouncementSection {
  id: string;
  heading: string | null;
  body: string;
}

export interface AnnouncementDocument {
  version: 1;
  sections: AnnouncementSection[];
}

const SECTION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export function normalizeAnnouncementDocument(value: unknown): AnnouncementDocument {
  if (!value || typeof value !== 'object') throw badRequest('Announcement content is required');

  const candidate = value as { version?: unknown; sections?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.sections)) {
    throw badRequest('Announcement content format is invalid');
  }
  if (candidate.sections.length < 1 || candidate.sections.length > 20) {
    throw badRequest('Announcements need between 1 and 20 sections');
  }

  let totalCharacters = 0;
  const sections = candidate.sections.map((section, index) => {
    if (!section || typeof section !== 'object') throw badRequest(`Section ${index + 1} is invalid`);
    const input = section as { id?: unknown; heading?: unknown; body?: unknown };
    const heading = typeof input.heading === 'string' ? input.heading.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';

    if (!body) throw badRequest(`Section ${index + 1} needs content`);
    if (heading.length > 120) throw badRequest(`Section ${index + 1} heading is too long`);
    if (body.length > 10_000) throw badRequest(`Section ${index + 1} is too long`);
    totalCharacters += heading.length + body.length;

    const suppliedId = typeof input.id === 'string' ? input.id.trim() : '';
    return {
      id: SECTION_ID_PATTERN.test(suppliedId) ? suppliedId : randomUUID(),
      heading: heading || null,
      body,
    };
  });

  if (totalCharacters > 40_000) throw badRequest('Announcement content is too long');
  return { version: 1, sections };
}
