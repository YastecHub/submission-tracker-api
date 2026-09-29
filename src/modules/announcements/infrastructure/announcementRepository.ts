import {
  AnnouncementCategory,
  AnnouncementPriority,
  AnnouncementSourceType,
  AnnouncementStatus,
  Prisma,
} from '@prisma/client';
import prisma from '../../../lib/prisma';
import { announcementSectionIds } from '../domain/announcementMedia';
import { announcementNotificationPayload, notificationPayloadJson } from '../domain/announcementNotification';
import { announcementMediaSelect, announcementMediaSnapshot } from './announcementMediaRepository';

export interface AnnouncementWriteData {
  title: string;
  summary: string;
  content: Prisma.InputJsonValue;
  rawSource: string | null;
  category: AnnouncementCategory;
  priority: AnnouncementPriority;
  sourceType: AnnouncementSourceType;
  contributorName: string | null;
  contributorCredit: string | null;
  isPinned: boolean;
  requiresAcknowledgement: boolean;
  paymentEventId: string | null;
}

export interface AnnouncementAiAcceptance {
  runId: string;
  requestedBy: string;
  acceptedFields: Prisma.InputJsonValue;
}

export class AnnouncementAiAcceptanceConflictError extends Error {
  constructor() {
    super('Announcement assistant acceptance conflict');
    this.name = 'AnnouncementAiAcceptanceConflictError';
  }
}

const staffDetailInclude = {
  creator: { select: { id: true, name: true, role: true } },
  updater: { select: { id: true, name: true, role: true } },
  publisher: { select: { id: true, name: true, role: true } },
  paymentEvent: {
    select: { id: true, slug: true, title: true, amount: true, deadline: true, hasTickets: true, isClosed: true, isDeleted: true },
  },
  revisions: {
    orderBy: { version: 'desc' as const },
    select: {
      id: true,
      version: true,
      changeNote: true,
      origin: true,
      createdAt: true,
      creator: { select: { id: true, name: true, role: true } },
    },
  },
  media: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    select: announcementMediaSelect,
  },
  _count: { select: { reads: true } },
};

export class AnnouncementRepository {
  findAdminPage(params: {
    skip: number;
    take: number;
    status?: AnnouncementStatus;
    category?: AnnouncementCategory;
    search?: string;
  }) {
    const where: Prisma.AnnouncementWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(params.search
        ? {
            OR: [
              { title: { contains: params.search, mode: 'insensitive' } },
              { summary: { contains: params.search, mode: 'insensitive' } },
              { contributorName: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return Promise.all([
      prisma.announcement.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: params.skip,
        take: params.take,
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          category: true,
          priority: true,
          status: true,
          isPinned: true,
          requiresAcknowledgement: true,
          version: true,
          publishedAt: true,
          updatedAt: true,
          creator: { select: { id: true, name: true, role: true } },
          updater: { select: { id: true, name: true, role: true } },
          _count: { select: { reads: true } },
        },
      }),
      prisma.announcement.count({ where }),
    ]);
  }

  findAdminById(id: string) {
    return prisma.announcement.findUnique({ where: { id }, include: staffDetailInclude });
  }

  findForAction(id: string) {
    return prisma.announcement.findUnique({
      where: { id },
      select: { id: true, createdBy: true, category: true, status: true, version: true },
    });
  }

  create(params: {
    data: AnnouncementWriteData & { slug: string; createdBy: string; updatedBy: string };
    aiAcceptance: AnnouncementAiAcceptance | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const created = await tx.announcement.create({ data: params.data });
      await this.recordAiAcceptance(tx, params.aiAcceptance, created.id);
      return tx.announcement.findUniqueOrThrow({ where: { id: created.id }, include: staffDetailInclude });
    });
  }

  async updateWithVersion(params: {
    id: string;
    expectedVersion: number;
    data: AnnouncementWriteData & { updatedBy: string };
    createRevision: boolean;
    changeNote: string | null;
    origin: 'manual' | 'ai_assisted';
    aiAcceptance: AnnouncementAiAcceptance | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const result = await tx.announcement.updateMany({
        where: { id: params.id, version: params.expectedVersion },
        data: { ...params.data, version: { increment: 1 } },
      });
      if (result.count !== 1) return null;

      const updated = await tx.announcement.findUniqueOrThrow({ where: { id: params.id } });
      const validSectionIds = Array.from(announcementSectionIds(updated.content));
      await tx.announcementMedia.updateMany({
        where: {
          announcementId: updated.id,
          sectionId: { not: null, notIn: validSectionIds },
        },
        data: { sectionId: null },
      });
      if (params.createRevision) {
        const media = await tx.announcementMedia.findMany({
          where: { announcementId: updated.id },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: announcementMediaSelect,
        });
        await tx.announcementRevision.create({
          data: {
            announcementId: updated.id,
            version: updated.version,
            title: updated.title,
            summary: updated.summary,
            content: updated.content as Prisma.InputJsonValue,
            media: announcementMediaSnapshot(media),
            changeNote: params.changeNote,
            origin: params.origin,
            createdBy: params.data.updatedBy,
          },
        });
        const subscriptions = await tx.studentPushSubscription.findMany({ select: { id: true } });
        if (subscriptions.length > 0) {
          const notification = notificationPayloadJson(announcementNotificationPayload(updated, {
            isUpdate: true,
            changeNote: params.changeNote,
          }));
          await tx.notificationOutbox.createMany({
            data: subscriptions.map((subscription) => ({
              subscriptionId: subscription.id,
              announcementId: updated.id,
              announcementVersion: updated.version,
              payload: notification,
            })),
            skipDuplicates: true,
          });
        }
      } else if (updated.status === 'published') {
        const subscriptions = await tx.studentPushSubscription.findMany({ select: { id: true } });
        if (subscriptions.length > 0) {
          const notification = notificationPayloadJson(announcementNotificationPayload(updated));
          await tx.notificationOutbox.createMany({
            data: subscriptions.map((subscription) => ({
              subscriptionId: subscription.id,
              announcementId: updated.id,
              announcementVersion: updated.version,
              payload: notification,
            })),
            skipDuplicates: true,
          });
        }
      }
      await this.recordAiAcceptance(tx, params.aiAcceptance, updated.id);
      return tx.announcement.findUniqueOrThrow({ where: { id: params.id }, include: staffDetailInclude });
    });
  }

  async publishWithVersion(id: string, expectedVersion: number, userId: string, changeNote: string | null) {
    return prisma.$transaction(async (tx) => {
      const result = await tx.announcement.updateMany({
        where: { id, version: expectedVersion, status: 'draft' },
        data: {
          status: 'published',
          publishedBy: userId,
          publishedAt: new Date(),
          archivedAt: null,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) return null;

      const published = await tx.announcement.findUniqueOrThrow({ where: { id } });
      const media = await tx.announcementMedia.findMany({
        where: { announcementId: id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: announcementMediaSelect,
      });
      await tx.announcementRevision.create({
        data: {
          announcementId: id,
          version: published.version,
          title: published.title,
          summary: published.summary,
          content: published.content as Prisma.InputJsonValue,
          media: announcementMediaSnapshot(media),
          changeNote,
          createdBy: userId,
        },
      });
      const subscriptions = await tx.studentPushSubscription.findMany({ select: { id: true } });
      if (subscriptions.length > 0) {
        const notification = notificationPayloadJson(announcementNotificationPayload(published));
        await tx.notificationOutbox.createMany({
          data: subscriptions.map((subscription) => ({
            subscriptionId: subscription.id,
            announcementId: published.id,
            announcementVersion: published.version,
            payload: notification,
          })),
          skipDuplicates: true,
        });
      }
      return tx.announcement.findUniqueOrThrow({ where: { id }, include: staffDetailInclude });
    }, { timeout: 15_000 });
  }

  async archiveWithVersion(id: string, expectedVersion: number, userId: string) {
    const result = await prisma.announcement.updateMany({
      where: { id, version: expectedVersion, status: 'published' },
      data: { status: 'archived', archivedAt: new Date(), updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count !== 1) return null;
    return this.findAdminById(id);
  }

  paymentOptions() {
    return prisma.paymentEvent.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, slug: true, title: true, amount: true, deadline: true, isClosed: true },
      take: 100,
    });
  }

  findPaymentOption(id: string) {
    return prisma.paymentEvent.findFirst({
      where: { id, isDeleted: false },
      select: { id: true },
    });
  }

  async findStudentFeed(params: {
    studentId: string;
    skip: number;
    take: number;
    category?: AnnouncementCategory;
    priority?: AnnouncementPriority;
    search?: string;
  }) {
    const where: Prisma.AnnouncementWhereInput = {
      status: 'published',
      ...(params.category ? { category: params.category } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      ...(params.search
        ? {
            OR: [
              { title: { contains: params.search, mode: 'insensitive' } },
              { summary: { contains: params.search, mode: 'insensitive' } },
              { contributorName: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return Promise.all([
      prisma.announcement.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
        skip: params.skip,
        take: params.take,
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          category: true,
          priority: true,
          sourceType: true,
          contributorName: true,
          contributorCredit: true,
          isPinned: true,
          requiresAcknowledgement: true,
          version: true,
          publishedAt: true,
          updatedAt: true,
          publisher: { select: { name: true, role: true } },
          media: {
            orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
            take: 1,
            select: { id: true, thumbnailUrl: true, altText: true },
          },
          reads: {
            where: { studentId: params.studentId },
            select: { lastReadVersion: true, acknowledgedVersion: true },
          },
        },
      }),
      prisma.announcement.count({ where }),
    ]);
  }

  findPublishedBySlug(slug: string, studentId: string) {
    return prisma.announcement.findFirst({
      where: { slug, status: 'published' },
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        content: true,
        category: true,
        priority: true,
        sourceType: true,
        contributorName: true,
        contributorCredit: true,
        isPinned: true,
        requiresAcknowledgement: true,
        version: true,
        publishedAt: true,
        updatedAt: true,
        publisher: { select: { name: true, role: true } },
        paymentEvent: {
          select: {
            slug: true,
            title: true,
            amount: true,
            deadline: true,
            hasTickets: true,
            isClosed: true,
            isDeleted: true,
          },
        },
        media: {
          orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
          select: announcementMediaSelect,
        },
        reads: {
          where: { studentId },
          select: { lastReadVersion: true, acknowledgedVersion: true },
        },
      },
    });
  }

  async unreadCount(studentId: string): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count"
      FROM "Announcement" announcement
      LEFT JOIN "AnnouncementRead" reading
        ON reading."announcementId" = announcement."id"
       AND reading."studentId" = ${studentId}
      WHERE announcement."status" = 'published'::"AnnouncementStatus"
        AND (reading."id" IS NULL OR reading."lastReadVersion" < announcement."version")
    `);
    return Number(rows[0]?.count ?? 0);
  }

  async markRead(id: string, studentId: string) {
    return prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.findFirst({
        where: { id, status: 'published' },
        select: { id: true, version: true },
      });
      if (!announcement) return null;
      await tx.announcementRead.upsert({
        where: { announcementId_studentId: { announcementId: id, studentId } },
        create: { announcementId: id, studentId, lastReadVersion: announcement.version },
        update: { lastReadVersion: announcement.version, lastReadAt: new Date() },
      });
      return { id, version: announcement.version, read: true };
    });
  }

  async acknowledge(id: string, studentId: string) {
    return prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.findFirst({
        where: { id, status: 'published', requiresAcknowledgement: true },
        select: { id: true, version: true },
      });
      if (!announcement) return null;
      const result = await tx.announcementRead.upsert({
        where: { announcementId_studentId: { announcementId: id, studentId } },
        create: {
          announcementId: id,
          studentId,
          lastReadVersion: announcement.version,
          acknowledgedVersion: announcement.version,
          acknowledgedAt: new Date(),
        },
        update: {
          lastReadVersion: announcement.version,
          acknowledgedVersion: announcement.version,
          acknowledgedAt: new Date(),
          lastReadAt: new Date(),
        },
      });
      return { id, version: announcement.version, acknowledged: true };
    });
  }

  async getAnalytics(id: string) {
    const announcement = await prisma.announcement.findUnique({
      where: { id },
      select: { id: true, version: true, requiresAcknowledgement: true, status: true },
    });
    if (!announcement) return null;

    const [
      totalReads,
      totalAcknowledged,
      totalRegisteredStudents,
      pushDelivered,
      pushPending,
      pushFailed,
    ] = await Promise.all([
      prisma.announcementRead.count({ where: { announcementId: id } }),
      prisma.announcementRead.count({
        where: {
          announcementId: id,
          acknowledgedVersion: { gte: announcement.version },
        },
      }),
      prisma.studentAccount.count(),
      prisma.notificationOutbox.count({ where: { announcementId: id, status: 'delivered' } }),
      prisma.notificationOutbox.count({ where: { announcementId: id, status: { in: ['pending', 'processing'] } } }),
      prisma.notificationOutbox.count({ where: { announcementId: id, status: 'dead' } }),
    ]);

    return {
      totalReads,
      totalAcknowledged,
      uniqueReaders: totalReads,
      totalRegisteredStudents,
      readRate: totalRegisteredStudents > 0 ? totalReads / totalRegisteredStudents : 0,
      acknowledgementRate: totalReads > 0 ? totalAcknowledged / totalReads : 0,
      classAcknowledgementRate: totalRegisteredStudents > 0 ? totalAcknowledged / totalRegisteredStudents : 0,
      pushStats: {
        delivered: pushDelivered,
        pending: pushPending,
        failed: pushFailed,
      },
      version: announcement.version,
      requiresAcknowledgement: announcement.requiresAcknowledgement,
      status: announcement.status,
    };
  }

  async getOutstandingStudents(id: string, params: { skip: number; take: number; search?: string }) {
    const announcement = await prisma.announcement.findUnique({
      where: { id },
      select: { id: true, version: true, requiresAcknowledgement: true },
    });
    if (!announcement || !announcement.requiresAcknowledgement) return null;

    const where: Prisma.StudentAccountWhereInput = {
      ...(params.search
        ? {
            OR: [
              { fullName: { contains: params.search, mode: 'insensitive' } },
              { matricNumber: { contains: params.search, mode: 'insensitive' } },
              { email: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      AND: [
        {
          OR: [
            { announcementReads: { none: { announcementId: id } } },
            {
              announcementReads: {
                some: {
                  announcementId: id,
                  OR: [
                    { acknowledgedVersion: null },
                    { acknowledgedVersion: { lt: announcement.version } },
                  ],
                },
              },
            },
          ],
        },
      ],
    };

    const [students, total] = await Promise.all([
      prisma.studentAccount.findMany({
        where,
        orderBy: [{ fullName: 'asc' }],
        skip: params.skip,
        take: params.take,
        select: {
          id: true,
          matricNumber: true,
          fullName: true,
          email: true,
          announcementReads: {
            where: { announcementId: id },
            select: {
              lastReadVersion: true,
              acknowledgedVersion: true,
              firstReadAt: true,
              lastReadAt: true,
              acknowledgedAt: true,
            },
          },
        },
      }),
      prisma.studentAccount.count({ where }),
    ]);

    return {
      students: students.map((s) => {
        const read = s.announcementReads[0] ?? null;
        return {
          id: s.id,
          matricNumber: s.matricNumber,
          fullName: s.fullName,
          email: s.email,
          hasOpened: Boolean(read),
          lastReadVersion: read?.lastReadVersion ?? null,
          acknowledgedVersion: read?.acknowledgedVersion ?? null,
          firstReadAt: read?.firstReadAt ?? null,
          lastReadAt: read?.lastReadAt ?? null,
          acknowledgedAt: read?.acknowledgedAt ?? null,
        };
      }),
      total,
      version: announcement.version,
    };
  }

  private async recordAiAcceptance(
    tx: Prisma.TransactionClient,
    acceptance: AnnouncementAiAcceptance | null,
    announcementId: string,
  ): Promise<void> {
    if (!acceptance) return;
    const result = await tx.announcementAiRun.updateMany({
      where: {
        id: acceptance.runId,
        requestedBy: acceptance.requestedBy,
        status: 'completed',
        acceptedAt: null,
        OR: [{ announcementId: null }, { announcementId }],
      },
      data: {
        announcementId,
        acceptedFields: acceptance.acceptedFields,
        acceptedAt: new Date(),
      },
    });
    if (result.count !== 1) throw new AnnouncementAiAcceptanceConflictError();
  }
}

export const announcementRepository = new AnnouncementRepository();
