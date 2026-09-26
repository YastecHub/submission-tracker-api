import { EventType, Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export type SubmissionEventWithCount = Prisma.SubmissionEventGetPayload<{
  include: { _count: { select: { submissions: true } } };
}>;

export class SubmissionEventRepository {
  findPage(params: { skip: number; take: number }) {
    return prisma.submissionEvent.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { submissions: true } } },
      skip: params.skip,
      take: params.take,
    });
  }

  countActive() {
    return prisma.submissionEvent.count({ where: { isDeleted: false } });
  }

  confirmedCountsByEvent(eventIds: string[]) {
    if (eventIds.length === 0) return Promise.resolve([]);
    return prisma.submission.groupBy({
      by: ['eventId'],
      where: { eventId: { in: eventIds }, isConfirmed: true },
      _count: { id: true },
    });
  }

  create(data: {
    slug: string;
    title: string;
    courseCode: string;
    type: EventType;
    description: string | null;
    deadline: Date;
    createdBy: string;
  }) {
    return prisma.submissionEvent.create({ data });
  }

  findPublicBySlug(slug: string) {
    return prisma.submissionEvent.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        courseCode: true,
        type: true,
        description: true,
        deadline: true,
        isClosed: true,
        isDeleted: true,
      },
    });
  }

  findActiveById(id: string) {
    return prisma.submissionEvent.findFirst({
      where: { id, isDeleted: false },
      include: { _count: { select: { submissions: true } } },
    });
  }

  findManageableById(id: string, user: Express.Request['user']) {
    return prisma.submissionEvent.findFirst({
      where: { id, ...(user!.role === 'dev' ? {} : { createdBy: user!.id }), isDeleted: false },
    });
  }

  confirmedCount(eventId: string) {
    return prisma.submission.count({ where: { eventId, isConfirmed: true } });
  }

  updateCloseState(id: string, isClosed: boolean) {
    return prisma.submissionEvent.update({ where: { id }, data: { isClosed } });
  }

  extend(id: string, deadline: Date) {
    return prisma.submissionEvent.update({ where: { id }, data: { deadline, isClosed: false } });
  }

  softDelete(id: string) {
    return prisma.submissionEvent.update({ where: { id }, data: { isDeleted: true } });
  }
}

export const submissionEventRepository = new SubmissionEventRepository();
