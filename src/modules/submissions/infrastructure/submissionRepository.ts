import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export class SubmissionRepository {
  findEventById(eventId: string) {
    return prisma.submissionEvent.findUnique({
      where: { id: eventId },
      select: { id: true, createdBy: true, courseCode: true, deadline: true, isClosed: true, isDeleted: true },
    });
  }

  findActiveEventById(eventId: string) {
    return prisma.submissionEvent.findFirst({ where: { id: eventId, isDeleted: false } });
  }

  findByMatricAndEvent(matricNumber: string, eventId: string) {
    return prisma.submission.findUnique({ where: { matricNumber_eventId: { matricNumber, eventId } } });
  }

  createPending(data: { eventId: string; fullName: string; matricNumber: string; level: string | null }) {
    return prisma.submission.create({ data: { ...data, qrCode: 'pending' } });
  }

  updateQrCode(id: string, qrCode: string) {
    return prisma.submission.update({ where: { id }, data: { qrCode } });
  }

  findCreatorPushSubscription(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: { pushSubscription: true } });
  }

  findPage(params: { where: Prisma.SubmissionWhereInput; skip: number; take: number }) {
    return prisma.submission.findMany({ where: params.where, orderBy: { submittedAt: 'desc' }, skip: params.skip, take: params.take });
  }

  count(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.count({ where });
  }

  findByIdWithEvent(id: string) {
    return prisma.submission.findUnique({ where: { id }, include: { event: { select: { createdBy: true } } } });
  }

  confirm(id: string, confirmerName: string) {
    return prisma.submission.update({
      where: { id },
      data: { isConfirmed: true, confirmedAt: new Date(), confirmedBy: confirmerName },
    });
  }

  confirmAll(eventId: string, confirmerName: string) {
    return prisma.submission.updateMany({
      where: { eventId, isConfirmed: false },
      data: { isConfirmed: true, confirmedAt: new Date(), confirmedBy: confirmerName },
    });
  }

  findStatus(id: string) {
    return prisma.submission.findUnique({ where: { id }, select: { isConfirmed: true, confirmedAt: true, confirmedBy: true } });
  }

  findConfirmedForExport(eventId: string) {
    return prisma.submission.findMany({ where: { eventId, isConfirmed: true }, orderBy: { confirmedAt: 'asc' } });
  }
}

export const submissionRepository = new SubmissionRepository();
