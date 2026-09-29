import { AnnouncementStatus, UserRole } from '@prisma/client';
import { destroyImage, uploadBulletinImage, type BulletinImageUpload } from '../../../lib/cloudinary';
import { AppError, badRequest, forbidden, notFound } from '../../../shared/errors/AppError';
import { canEditAnnouncement } from '../domain/announcementPolicy';
import {
  announcementSectionIds,
  normalizeMediaUpdates,
  normalizeMediaUploadMetadata,
} from '../domain/announcementMedia';
import {
  announcementMediaRepository,
  AnnouncementMediaRepository,
} from '../infrastructure/announcementMediaRepository';

type StaffUser = NonNullable<Express.Request['user']>;
const MAX_ANNOUNCEMENT_IMAGES = 12;
const MAX_IMAGES_PER_UPLOAD = 8;

function version(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw badRequest('The announcement version is invalid');
  return parsed;
}

function changeNote(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw badRequest('Change note is invalid');
  const normalized = value.trim();
  if (normalized.length > 300) throw badRequest('Change note is too long');
  return normalized || fallback;
}

function requestObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class AnnouncementMediaService {
  constructor(private readonly repository: AnnouncementMediaRepository) {}

  async upload(
    announcementId: string,
    inputValue: unknown,
    files: Express.Multer.File[],
    user: StaffUser,
  ) {
    const input = requestObject(inputValue);
    if (files.length < 1) throw badRequest('Choose at least one image to upload');
    if (files.length > MAX_IMAGES_PER_UPLOAD) throw badRequest(`Upload no more than ${MAX_IMAGES_PER_UPLOAD} images at once`);

    const current = await this.editableAnnouncement(announcementId, user);
    const expectedVersion = version(input.expectedVersion);
    if (current.version !== expectedVersion) this.throwVersionConflict();

    const existingCount = await this.repository.count(announcementId);
    if (existingCount + files.length > MAX_ANNOUNCEMENT_IMAGES) {
      throw badRequest(`An announcement can contain up to ${MAX_ANNOUNCEMENT_IMAGES} images`);
    }

    const metadata = normalizeMediaUploadMetadata(
      input.metadata,
      files.length,
      announcementSectionIds(current.content),
    );
    const uploads = await Promise.allSettled(files.map((file) => uploadBulletinImage(file.buffer)));
    const uploaded = uploads.flatMap((outcome): BulletinImageUpload[] =>
      outcome.status === 'fulfilled' ? [outcome.value] : []
    );
    if (uploaded.length !== files.length) {
      await Promise.all(uploaded.map((image) => destroyImage(image.publicId)));
      throw new AppError(502, 'The images could not be uploaded. Nothing was added.');
    }

    try {
      const result = await this.repository.addWithVersion({
        announcementId,
        expectedVersion,
        userId: user.id,
        createRevision: current.status === 'published',
        changeNote: current.status === 'published' ? changeNote(input.changeNote, 'Added announcement images') : null,
        images: uploaded.map((image, index) => ({ ...image, ...metadata[index] })),
      });
      if (!result) this.throwVersionConflict();
      return result;
    } catch (error) {
      await Promise.all(uploaded.map((image) => destroyImage(image.publicId)));
      throw error;
    }
  }

  async update(announcementId: string, inputValue: unknown, user: StaffUser) {
    const input = requestObject(inputValue);
    const current = await this.editableAnnouncement(announcementId, user);
    const expectedVersion = version(input.expectedVersion);
    if (current.version !== expectedVersion) this.throwVersionConflict();

    const existing = await this.repository.list(announcementId);
    if (existing.length < 1) throw badRequest('This announcement does not have images to update');
    const items = normalizeMediaUpdates(
      input.items,
      existing.map((media) => media.id),
      announcementSectionIds(current.content),
    );

    const result = await this.repository.updateWithVersion({
      announcementId,
      expectedVersion,
      userId: user.id,
      createRevision: current.status === 'published',
      changeNote: current.status === 'published' ? changeNote(input.changeNote, 'Updated announcement images') : null,
      items,
    });
    if (!result) this.throwVersionConflict();
    return result;
  }

  async remove(announcementId: string, mediaId: string, inputValue: unknown, user: StaffUser) {
    const input = requestObject(inputValue);
    const current = await this.editableAnnouncement(announcementId, user);
    const expectedVersion = version(input.expectedVersion);
    if (current.version !== expectedVersion) this.throwVersionConflict();

    const media = await this.repository.findForDelete(mediaId, announcementId);
    if (!media) throw notFound('Announcement image not found');

    const result = await this.repository.deleteWithVersion({
      announcementId,
      mediaId,
      expectedVersion,
      userId: user.id,
      createRevision: current.status === 'published',
      changeNote: current.status === 'published' ? changeNote(input.changeNote, 'Removed an announcement image') : null,
    });
    if (!result) this.throwVersionConflict();
    await destroyImage(media.publicId);
    return result;
  }

  private async editableAnnouncement(announcementId: string, user: StaffUser) {
    const announcement = await this.repository.findAnnouncementForAction(announcementId);
    if (!announcement) throw notFound('Announcement not found');
    if (!canEditAnnouncement({ id: user.id, role: user.role as UserRole }, announcement)) {
      throw forbidden('You are not allowed to edit this announcement');
    }
    return announcement as typeof announcement & { status: AnnouncementStatus };
  }

  private throwVersionConflict(): never {
    throw new AppError(409, 'This announcement was changed elsewhere. Reload it before changing images.');
  }
}

export const announcementMediaService = new AnnouncementMediaService(announcementMediaRepository);
