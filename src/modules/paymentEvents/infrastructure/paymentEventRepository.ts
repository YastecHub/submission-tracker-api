import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';

export class PaymentEventRepository {
  findPage(params: { skip: number; take: number }) {
    return prisma.paymentEvent.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { receipts: true } } },
      skip: params.skip,
      take: params.take,
    });
  }

  countActive() {
    return prisma.paymentEvent.count({ where: { isDeleted: false } });
  }

  receiptStatusCounts() {
    return prisma.paymentReceipt.groupBy({
      by: ['eventId', 'status'],
      _count: { id: true },
    });
  }

  create(data: {
    slug: string;
    title: string;
    description: string | null;
    amount: Prisma.Decimal;
    accountNumber: string;
    accountName: string;
    bankName: string;
    deadline: Date;
    hasTickets: boolean;
    createdBy: string;
  }) {
    return prisma.paymentEvent.create({ data });
  }

  findPublicBySlug(slug: string) {
    return prisma.paymentEvent.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        amount: true,
        accountNumber: true,
        accountName: true,
        bankName: true,
        deadline: true,
        hasTickets: true,
        isClosed: true,
        isDeleted: true,
      },
    });
  }

  findActiveById(id: string) {
    return prisma.paymentEvent.findFirst({
      where: { id, isDeleted: false },
      include: { _count: { select: { receipts: true } } },
    });
  }

  findManageableById(id: string, user: Express.Request['user']) {
    return prisma.paymentEvent.findFirst({
      where: {
        id,
        ...(user!.role === 'dev' || user!.role === 'fin_sec' ? {} : { createdBy: user!.id }),
        isDeleted: false,
      },
    });
  }

  receiptCounts(eventId: string) {
    return Promise.all([
      prisma.paymentReceipt.count({ where: { eventId, status: 'confirmed' } }),
      prisma.paymentReceipt.count({ where: { eventId, status: 'rejected' } }),
      prisma.paymentReceipt.count({ where: { eventId, status: 'pending' } }),
    ]);
  }

  update(id: string, data: { hasTickets?: boolean; description?: string | null }) {
    return prisma.paymentEvent.update({ where: { id }, data });
  }

  confirmedReceiptsWithoutTickets(eventId: string) {
    return prisma.paymentReceipt.findMany({
      where: { eventId, status: 'confirmed', ticketQrCode: null },
      select: { id: true },
    });
  }

  updateReceiptTicketQrCode(receiptId: string, ticketQrCode: string) {
    return prisma.paymentReceipt.update({ where: { id: receiptId }, data: { ticketQrCode } });
  }

  updateCloseState(id: string, isClosed: boolean) {
    return prisma.paymentEvent.update({ where: { id }, data: { isClosed } });
  }

  extend(id: string, deadline: Date) {
    return prisma.paymentEvent.update({ where: { id }, data: { deadline, isClosed: false } });
  }

  softDelete(id: string) {
    return prisma.paymentEvent.update({ where: { id }, data: { isDeleted: true } });
  }
}

export const paymentEventRepository = new PaymentEventRepository();
