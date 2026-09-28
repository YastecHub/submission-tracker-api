import {
  AnnouncementCategory,
  AnnouncementPriority,
  AnnouncementSourceType,
  AnnouncementStatus,
  Prisma,
} from '@prisma/client';
import prisma from '../../../lib/prisma';

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
      if (params.createRevision) {
        await tx.announcementRevision.create({
          data: {
            announcementId: updated.id,
            version: updated.version,
            title: updated.title,
            summary: updated.summary,
            content: updated.content as Prisma.InputJsonValue,
            changeNote: params.changeNote,
            origin: params.origin,
            createdBy: params.data.updatedBy,
          },
        });
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
      await tx.announcementRevision.create({
        data: {
          announcementId: id,
          version: published.version,
          title: published.title,
          summary: published.summary,
          content: published.content as Prisma.InputJsonValue,
          changeNote,
          createdBy: userId,
        },
      });
      return tx.announcement.findUniqueOrThrow({ where: { id }, include: staffDetailInclude });
    });
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
