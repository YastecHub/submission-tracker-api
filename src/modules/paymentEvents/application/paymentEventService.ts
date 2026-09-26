import { Prisma } from '@prisma/client';
import { uniquePaymentSlug } from '../../../utils/slugGenerator';
import { generateQR } from '../../../utils/qrGenerator';
import { badRequest, forbidden, notFound } from '../../../shared/errors/AppError';
import { paymentEventRepository, PaymentEventRepository } from '../infrastructure/paymentEventRepository';

function canManage(user: Express.Request['user'], event: { createdBy: string }): boolean {
  return user!.role === 'dev' || user!.role === 'fin_sec' || event.createdBy === user!.id;
}

export class PaymentEventService {
  constructor(private readonly repository: PaymentEventRepository) {}

  async list(query: { page?: string; limit?: string }) {
    const page = Math.max(1, parseInt(query.page ?? '') || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '') || 20));
    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      this.repository.findPage({ skip, take: limit }),
      this.repository.countActive(),
    ]);

    const statusGroups = await this.repository.receiptStatusCounts(events.map((event) => event.id));

    const statusMap = new Map<string, { confirmed: number; rejected: number; pending: number }>();
    for (const group of statusGroups) {
      if (!statusMap.has(group.eventId)) statusMap.set(group.eventId, { confirmed: 0, rejected: 0, pending: 0 });
      const entry = statusMap.get(group.eventId)!;
      if (group.status === 'confirmed') entry.confirmed = group._count.id;
      if (group.status === 'rejected') entry.rejected = group._count.id;
      if (group.status === 'pending') entry.pending = group._count.id;
    }

    return {
      events: events.map((event) => {
        const stats = statusMap.get(event.id) ?? { confirmed: 0, rejected: 0, pending: 0 };
        return {
          ...event,
          totalReceipts: event._count.receipts,
          confirmedCount: stats.confirmed,
          rejectedCount: stats.rejected,
          pendingCount: stats.pending,
        };
      }),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(input: {
    title?: string;
    description?: string;
    amount?: string;
    accountNumber?: string;
    accountName?: string;
    bankName?: string;
    deadline?: string;
    hasTickets?: boolean;
    userId: string;
  }) {
    if (!input.title || !input.amount || !input.accountNumber || !input.accountName || !input.bankName || !input.deadline) {
      throw badRequest('title, amount, accountNumber, accountName, bankName, and deadline are required');
    }

    const title = input.title.trim();
    const description = input.description?.trim() || null;
    const accountNumber = input.accountNumber.trim();
    const accountName = input.accountName.trim();
    const bankName = input.bankName.trim();
    const parsedAmount = /^\d+(\.\d{1,2})?$/.test(input.amount.trim()) ? Number(input.amount) : NaN;
    const deadline = new Date(input.deadline);

    if (!title || title.length > 150 || accountNumber.length > 50 || accountName.length > 100 || bankName.length > 100) {
      throw badRequest('payment event fields are invalid or too long');
    }
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) throw badRequest('amount must be a positive number');
    if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) throw badRequest('deadline must be a valid future date');

    return this.repository.create({
      slug: await uniquePaymentSlug(title),
      title,
      description,
      amount: new Prisma.Decimal(parsedAmount),
      accountNumber,
      accountName,
      bankName,
      deadline,
      hasTickets: !!input.hasTickets,
      createdBy: input.userId,
    });
  }

  async getPublicBySlug(slug: string) {
    const event = await this.repository.findPublicBySlug(slug);
    if (!event || event.isDeleted) throw notFound('Payment event not found');
    return event;
  }

  async getById(id: string, user: Express.Request['user']) {
    const event = await this.repository.findActiveById(id);
    if (!event) throw notFound('Payment event not found');
    if (!canManage(user, event)) throw forbidden('You are not allowed to view this payment event');

    const [confirmedCount, rejectedCount, pendingCount] = await this.repository.receiptCounts(id);
    return {
      ...event,
      totalReceipts: event._count.receipts,
      confirmedCount,
      rejectedCount,
      pendingCount,
    };
  }

  async update(id: string, input: { hasTickets?: boolean; description?: string }, user: Express.Request['user']) {
    const event = await this.repository.findManageableById(id, user);
    if (!event) throw notFound('Payment event not found or not authorised');

    const updates: { hasTickets?: boolean; description?: string | null } = {};
    if (input.hasTickets !== undefined) updates.hasTickets = !!input.hasTickets;
    if (input.description !== undefined) updates.description = input.description?.trim() || null;

    const updated = await this.repository.update(id, updates);

    if (!event.hasTickets && updates.hasTickets === true) {
      const receipts = await this.repository.confirmedReceiptsWithoutTickets(id);
      for (const receipt of receipts) {
        await this.repository.updateReceiptTicketQrCode(receipt.id, await generateQR(receipt.id));
      }
    }

    return updated;
  }

  async toggleClose(id: string, user: Express.Request['user']) {
    const event = await this.repository.findManageableById(id, user);
    if (!event) throw notFound('Payment event not found or not authorised');
    return this.repository.updateCloseState(id, !event.isClosed);
  }

  async extend(id: string, deadlineInput: string | undefined, user: Express.Request['user']) {
    if (!deadlineInput) throw badRequest('deadline is required');
    const deadline = new Date(deadlineInput);
    if (Number.isNaN(deadline.getTime())) throw badRequest('deadline must be a valid date');
    if (deadline <= new Date()) throw badRequest('deadline must be in the future');

    const event = await this.repository.findManageableById(id, user);
    if (!event) throw notFound('Payment event not found or not authorised');
    return this.repository.extend(id, deadline);
  }

  async delete(id: string, user: Express.Request['user']) {
    const event = await this.repository.findManageableById(id, user);
    if (!event) throw notFound('Payment event not found or not authorised');
    await this.repository.softDelete(id);
    return { message: 'Payment event deleted' };
  }
}

export const paymentEventService = new PaymentEventService(paymentEventRepository);
