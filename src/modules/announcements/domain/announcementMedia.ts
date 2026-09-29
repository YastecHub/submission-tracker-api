import { badRequest } from '../../../shared/errors/AppError';

export interface AnnouncementMediaPlacement {
  altText: string;
  caption: string | null;
  sectionId: string | null;
}

export interface AnnouncementMediaUpdate extends AnnouncementMediaPlacement {
  id: string;
  sortOrder: number;
}

function parsedArray(value: unknown, label: string): unknown[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw badRequest(`${label} are invalid`);
    }
  }
  if (!Array.isArray(parsed)) throw badRequest(`${label} are invalid`);
  return parsed;
}

function text(value: unknown, max: number, label: string, required: boolean): string | null {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return null;
    throw badRequest(`${label} is required`);
  }
  const normalized = value.trim();
  if (required && !normalized) throw badRequest(`${label} is required`);
  if (normalized.length > max) throw badRequest(`${label} is too long`);
  return normalized || null;
}

function placement(value: unknown, sectionIds: Set<string>, position: number): AnnouncementMediaPlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest(`Image ${position} details are invalid`);
  }
  const input = value as { altText?: unknown; caption?: unknown; sectionId?: unknown };
  const sectionId = text(input.sectionId, 80, `Image ${position} section`, false);
  if (sectionId && !sectionIds.has(sectionId)) {
    throw badRequest(`Image ${position} must be assigned to an existing section`);
  }
  return {
    altText: text(input.altText, 240, `Image ${position} alt text`, true)!,
    caption: text(input.caption, 500, `Image ${position} caption`, false),
    sectionId,
  };
}

export function announcementSectionIds(content: unknown): Set<string> {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return new Set();
  const sections = (content as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return new Set();
  return new Set(sections.flatMap((section) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return [];
    const id = (section as { id?: unknown }).id;
    return typeof id === 'string' ? [id] : [];
  }));
}

export function normalizeMediaUploadMetadata(
  value: unknown,
  fileCount: number,
  sectionIds: Set<string>,
): AnnouncementMediaPlacement[] {
  const items = parsedArray(value, 'Image details');
  if (items.length !== fileCount) throw badRequest('Add alt text and placement details for every image');
  return items.map((item, index) => placement(item, sectionIds, index + 1));
}

export function normalizeMediaUpdates(
  value: unknown,
  existingIds: string[],
  sectionIds: Set<string>,
): AnnouncementMediaUpdate[] {
  const items = parsedArray(value, 'Image details');
  if (items.length !== existingIds.length) throw badRequest('Save details for every announcement image together');

  const existing = new Set(existingIds);
  const seen = new Set<string>();
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw badRequest(`Image ${index + 1} details are invalid`);
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string' || !existing.has(id) || seen.has(id)) throw badRequest('The image order is invalid');
    seen.add(id);
    return { id, sortOrder: index, ...placement(item, sectionIds, index + 1) };
  });
}
