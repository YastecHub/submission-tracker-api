import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import type {
  AnnouncementMediaUpdate,
  AnnouncementMediaPlacement,
} from '../domain/announcementMedia';
import type { BulletinImageUpload } from '../../../lib/cloudinary';

export const announcementMediaSelect = {
  id: true,
  url: true,
  thumbnailUrl: true,
  altText: true,
  caption: true,
  sectionId: true,
  sortOrder: true,
  width: true,
  height: true,
  bytes: true,
  format: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function announcementMediaSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class AnnouncementMediaRepository {
  findAnnouncementForAction(id: string) {
    return prisma.announcement.findUnique({
      where: { id },
      select: {
        id: true,
        createdBy: true,
        category: true,
        status: true,
        version: true,
        content: true,
      },
    });
  }

  list(announcementId: string) {
    return prisma.announcementMedia.findMany({
      where: { announcementId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: announcementMediaSelect,
    });
  }

  count(announcementId: string) {
    return prisma.announcementMedia.count({ where: { announcementId } });
  }

  findForDelete(id: string, announcementId: string) {
    return prisma.announcementMedia.findFirst({
      where: { id, announcementId },
      select: { id: true, publicId: true },
    });
  }

  async addWithVersion(params: {
    announcementId: string;
    expectedVersion: number;
    userId: string;
    createRevision: boolean;
    changeNote: string | null;
    images: Array<BulletinImageUpload & AnnouncementMediaPlacement>;
  }) {
    return prisma.$transaction(async (tx) => {
      const versioned = await tx.announcement.updateMany({
        where: { id: params.announcementId, version: params.expectedVersion },
        data: { updatedBy: params.userId, version: { increment: 1 } },
      });
      if (versioned.count !== 1) return null;

      const highest = await tx.announcementMedia.aggregate({
        where: { announcementId: params.announcementId },
        _max: { sortOrder: true },
      });
      const firstOrder = (highest._max.sortOrder ?? -1) + 1;
      await tx.announcementMedia.createMany({
        data: params.images.map((image, index) => ({
          announcementId: params.announcementId,
          publicId: image.publicId,
          url: image.url,
          thumbnailUrl: image.thumbnailUrl,
          altText: image.altText,
          caption: image.caption,
          sectionId: image.sectionId,
          sortOrder: firstOrder + index,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
          format: image.format,
          createdBy: params.userId,
        })),
      });

      return this.finishMutation(tx, params.announcementId, params.userId, params.createRevision, params.changeNote);
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  async updateWithVersion(params: {
    announcementId: string;
    expectedVersion: number;
    userId: string;
    createRevision: boolean;
    changeNote: string | null;
    items: AnnouncementMediaUpdate[];
  }) {
    return prisma.$transaction(async (tx) => {
      const versioned = await tx.announcement.updateMany({
        where: { id: params.announcementId, version: params.expectedVersion },
        data: { updatedBy: params.userId, version: { increment: 1 } },
      });
      if (versioned.count !== 1) return null;

      for (const item of params.items) {
        await tx.announcementMedia.update({
          where: { id: item.id },
          data: {
            altText: item.altText,
            caption: item.caption,
            sectionId: item.sectionId,
            sortOrder: item.sortOrder,
          },
        });
      }

      return this.finishMutation(tx, params.announcementId, params.userId, params.createRevision, params.changeNote);
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  async deleteWithVersion(params: {
    announcementId: string;
    mediaId: string;
    expectedVersion: number;
    userId: string;
    createRevision: boolean;
    changeNote: string | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const versioned = await tx.announcement.updateMany({
        where: { id: params.announcementId, version: params.expectedVersion },
        data: { updatedBy: params.userId, version: { increment: 1 } },
      });
      if (versioned.count !== 1) return null;

      await tx.announcementMedia.delete({ where: { id: params.mediaId } });

      const remaining = await tx.announcementMedia.findMany({
        where: { announcementId: params.announcementId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      for (const [sortOrder, media] of remaining.entries()) {
        await tx.announcementMedia.update({ where: { id: media.id }, data: { sortOrder } });
      }

      return this.finishMutation(tx, params.announcementId, params.userId, params.createRevision, params.changeNote);
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  private async finishMutation(
    tx: Prisma.TransactionClient,
    announcementId: string,
    userId: string,
    createRevision: boolean,
    changeNote: string | null,
  ) {
    const [announcement, media] = await Promise.all([
      tx.announcement.findUniqueOrThrow({ where: { id: announcementId } }),
      tx.announcementMedia.findMany({
        where: { announcementId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: announcementMediaSelect,
      }),
    ]);

    if (createRevision) {
      await tx.announcementRevision.create({
        data: {
          announcementId,
          version: announcement.version,
          title: announcement.title,
          summary: announcement.summary,
          content: announcement.content as Prisma.InputJsonValue,
          media: announcementMediaSnapshot(media),
          changeNote,
          origin: 'manual',
          createdBy: userId,
        },
      });
    }

    return { version: announcement.version, updatedAt: announcement.updatedAt, media };
  }
}

export const announcementMediaRepository = new AnnouncementMediaRepository();
