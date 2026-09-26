import { Prisma, PaymentStatus } from '@prisma/client';
import prisma from '../../../lib/prisma';

export class PaymentReceiptRepository {
  findEventById(eventId: string) {
    return prisma.paymentEvent.findUnique({ where: { id: eventId } });
  }

  findActiveEventById(eventId: string) {
    return prisma.paymentEvent.findFirst({ where: { id: eventId, isDeleted: false } });
  }

  findByMatricAndEvent(matricNumber: string, eventId: string) {
    return prisma.paymentReceipt.findUnique({ where: { matricNumber_eventId: { matricNumber, eventId } } });
  }

  create(data: { eventId: string; fullName: string; matricNumber: string; level: string | null; receiptUrl: string; receiptPublicId: string }) {
    return prisma.paymentReceipt.create({ data });
  }

  updateTicketQrCode(receiptId: string, ticketQrCode: string) {
    return prisma.paymentReceipt.update({ where: { id: receiptId }, data: { ticketQrCode } });
  }

  findPage(params: { where: Prisma.PaymentReceiptWhereInput; skip: number; take: number }) {
    return prisma.paymentReceipt.findMany({ where: params.where, orderBy: { submittedAt: 'desc' }, skip: params.skip, take: params.take });
  }

  count(where: Prisma.PaymentReceiptWhereInput) {
    return prisma.paymentReceipt.count({ where });
  }

  findForExport(eventId: string) {
    return prisma.paymentReceipt.findMany({ where: { eventId }, orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }] });
  }

  findWithEventAndTransaction(id: string) {
    return prisma.paymentReceipt.findUnique({ where: { id }, include: { event: true, transaction: true } });
  }

  confirm(id: string, input: { confirmedBy: string; recordedBy: string; note?: string | null; ticketQrCode?: string }) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.findUnique({ where: { id }, include: { event: true, transaction: true } });
      if (!receipt) return null;

      const wasConfirmed = receipt.status === 'confirmed';
      const updatedReceipt = await tx.paymentReceipt.update({
        where: { id },
        data: {
          status: 'confirmed',
          confirmedAt: now,
          confirmedBy: input.confirmedBy,
          note: input.note ?? null,
          ...(input.ticketQrCode ? { ticketQrCode: input.ticketQrCode } : {}),
        },
      });

      if (!wasConfirmed) {
        if (receipt.transaction && receipt.transaction.isDeleted) {
          await tx.transaction.update({ where: { id: receipt.transaction.id }, data: { isDeleted: false, occurredAt: now, recordedBy: input.recordedBy } });
        } else if (!receipt.transaction) {
          await tx.transaction.create({
            data: {
              type: 'credit',
              amount: receipt.event.amount,
              description: `Payment: ${receipt.event.title} — ${receipt.matricNumber}`,
              category: 'Dues',
              occurredAt: now,
              recordedBy: input.recordedBy,
              receiptId: receipt.id,
            },
          });
        }
      }

      return updatedReceipt;
    });
  }

  reject(id: string, input: { confirmedBy: string; note?: string | null }) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.findUnique({ where: { id }, include: { transaction: true, event: true } });
      if (!receipt) return null;

      const wasConfirmed = receipt.status === 'confirmed';
      const updatedReceipt = await tx.paymentReceipt.update({
        where: { id },
        data: { status: 'rejected', confirmedAt: now, confirmedBy: input.confirmedBy, note: input.note ?? null },
      });

      if (wasConfirmed && receipt.transaction && !receipt.transaction.isDeleted) {
        await tx.transaction.update({ where: { id: receipt.transaction.id }, data: { isDeleted: true } });
      }

      return updatedReceipt;
    });
  }

  findStatus(id: string) {
    return prisma.paymentReceipt.findUnique({ where: { id }, include: { event: { select: { title: true, hasTickets: true } } } });
  }

  findConfirmedTicketsByMatric(matricNumber: string) {
    return prisma.paymentReceipt.findMany({
      where: { matricNumber, status: 'confirmed', event: { hasTickets: true, isDeleted: false } },
      include: { event: { select: { title: true, slug: true, amount: true, hasTickets: true } } },
      orderBy: { confirmedAt: 'desc' },
    });
  }

  findTicketByShortCode(code: string) {
    return prisma.paymentReceipt.findFirst({ where: { id: { startsWith: code.toLowerCase() }, event: { hasTickets: true } }, include: { event: true } });
  }

  findTicketById(id: string) {
    return prisma.paymentReceipt.findUnique({ where: { id }, include: { event: true } });
  }

  claim(id: string, claimedBy: string) {
    const now = new Date();
    return prisma.paymentReceipt.updateMany({ where: { id, isClaimed: false }, data: { isClaimed: true, claimedAt: now, claimedBy } });
  }

  findById(id: string) {
    return prisma.paymentReceipt.findUnique({ where: { id } });
  }
}

export const paymentReceiptRepository = new PaymentReceiptRepository();
