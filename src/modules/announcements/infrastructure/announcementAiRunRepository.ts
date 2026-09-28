import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export class AnnouncementAiRunRepository {
  createCompleted(data: {
    announcementId: string | null;
    requestedBy: string;
    provider: string;
    model: string;
    promptVersion: string;
    sourceHash: string;
    sourceLength: number;
    result: Prisma.InputJsonValue;
    latencyMs: number;
  }) {
    return prisma.announcementAiRun.create({
      data: { ...data, status: 'completed' },
      select: { id: true, provider: true, model: true, promptVersion: true, createdAt: true },
    });
  }

  createFailed(data: {
    announcementId: string | null;
    requestedBy: string;
    provider: string;
    model: string;
    promptVersion: string;
    sourceHash: string;
    sourceLength: number;
    latencyMs: number;
    errorCode: string;
  }) {
    return prisma.announcementAiRun.create({ data: { ...data, status: 'failed' } });
  }

  findOwnedCompleted(id: string, requestedBy: string) {
    return prisma.announcementAiRun.findFirst({
      where: { id, requestedBy, status: 'completed', acceptedAt: null },
      select: { id: true, sourceHash: true, announcementId: true, result: true },
    });
  }
}

export const announcementAiRunRepository = new AnnouncementAiRunRepository();
