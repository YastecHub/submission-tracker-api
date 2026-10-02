import { Prisma } from '@prisma/client';
import { uploadImageBuffer } from '../../../lib/cloudinary';
import { generateQR } from '../../../utils/qrGenerator';
import { exportPaymentReceipts } from '../../../utils/excelExporter';
import { checkReceiptAmountInBackground } from '../../../utils/receiptAmountChecker';
import { AppError, badRequest, forbidden, notFound } from '../../../shared/errors/AppError';
import logger from '../../../lib/logger';
import { paymentReceiptRepository, PaymentReceiptRepository } from '../infrastructure/paymentReceiptRepository';
import { cacheDeletePrefix } from '../../../utils/cache';

const MAX_EXPORT_ROWS = 10_000;

function canManage(user: Express.Request['user'], event: { createdBy: string }): boolean {
  return user!.role === 'dev' || user!.role === 'fin_sec' || event.createdBy === user!.id;
}

export class PaymentReceiptService {
  constructor(private readonly repository: PaymentReceiptRepository) { }

  async submit(input: { eventId?: string; level?: string; file?: Express.Multer.File }, student: NonNullable<Express.Request['student']>) {
    if (!input.eventId) throw badRequest('eventId is required');
    if (!input.file) throw badRequest('Payment receipt image is required');

    const fullName = student.fullName.trim();
    const matricNumber = student.matricNumber.trim().toUpperCase();
    const level = input.level?.trim() || null;
    if (!fullName || !matricNumber || fullName.length > 120 || matricNumber.length > 50) {
      throw badRequest('fullName and matricNumber must be valid and reasonably short');
    }

    const event = await this.repository.findEventById(input.eventId);
    if (!event || event.isDeleted) throw notFound('Payment event not found');
    if (event.isClosed || new Date() > new Date(event.deadline)) throw forbidden('Payment event is closed or deadline has passed');
    if (await this.repository.findByMatricAndEvent(matricNumber, input.eventId)) {
      throw new AppError(409, 'You have already submitted a receipt for this payment');
    }

    let uploaded;
    try {
      uploaded = await uploadImageBuffer(input.file.buffer, 'payment-receipts');
    } catch {
      throw new AppError(500, 'Failed to upload receipt image. Please try again.');
    }

    let receipt;
    try {
      receipt = await this.repository.create({ eventId: input.eventId, fullName, matricNumber, level, receiptUrl: uploaded.url, receiptPublicId: uploaded.publicId });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'You have already submitted a receipt for this payment');
      }
      throw error;
    }

    let responseReceipt = receipt;
    if (event.hasTickets && !receipt.ticketQrCode) {
      responseReceipt = await this.repository.updateTicketQrCode(receipt.id, await generateQR(receipt.id));
    }

    void checkReceiptAmountInBackground({ receiptId: receipt.id, receiptUrl: uploaded.url, expectedAmount: event.amount }).catch((err) => logger.error('[receipt amount check] Background check failed:', { error: err, receiptId: receipt.id }));
    return { receipt: responseReceipt };
  }

  async list(eventId: string, query: { page?: string; limit?: string; search?: string; status?: string }) {
    const page = Math.max(1, parseInt(query.page ?? '') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '') || 50));
    const search = (query.search ?? '').trim();
    const skip = (page - 1) * limit;

    const event = await this.repository.findActiveEventById(eventId);
    if (!event) throw notFound('Payment event not found');
    const where: Prisma.PaymentReceiptWhereInput = {
      eventId,
      ...(search.length >= 2 ? { OR: [{ fullName: { contains: search, mode: Prisma.QueryMode.insensitive } }, { matricNumber: { contains: search, mode: Prisma.QueryMode.insensitive } }] } : {}),
      ...(query.status && ['pending', 'confirmed', 'rejected'].includes(query.status) ? { status: query.status as 'pending' | 'confirmed' | 'rejected' } : {}),
    };

    const [receipts, total, confirmedTotal, rejectedTotal, pendingTotal, claimedTotal] = await Promise.all([
      this.repository.findPage({ where, skip, take: limit }),
      this.repository.count(where),
      this.repository.count({ eventId, status: 'confirmed' }),
      this.repository.count({ eventId, status: 'rejected' }),
      this.repository.count({ eventId, status: 'pending' }),
      this.repository.count({ eventId, isClaimed: true }),
    ]);

    return { receipts, total, confirmedTotal, rejectedTotal, pendingTotal, claimedTotal, page, totalPages: Math.ceil(total / limit), limit };
  }

  async export(eventId: string) {
    const event = await this.repository.findActiveEventById(eventId);
    if (!event) throw notFound('Payment event not found');
    const total = await this.repository.count({ eventId });
    if (total > MAX_EXPORT_ROWS) throw badRequest(`Export is limited to ${MAX_EXPORT_ROWS} rows. Use filters or contact support.`);
    return exportPaymentReceipts(await this.repository.findForExport(eventId), event);
  }

  async confirm(id: string, input: { note?: string }, user: Express.Request['user']) {
    const receipt = await this.repository.findWithEventAndTransaction(id);
    if (!receipt) throw notFound('Receipt not found');
    if (!canManage(user, receipt.event)) throw forbidden('You are not allowed to confirm this receipt');
    const ticketQrCode = receipt.event.hasTickets && !receipt.ticketQrCode ? await generateQR(receipt.id) : undefined;
    const updated = await this.repository.confirm(id, { confirmedBy: user!.name, recordedBy: user!.id, note: input.note, ticketQrCode });
    cacheDeletePrefix('ledger:');
    return updated;
  }

  async reject(id: string, input: { note?: string }, user: Express.Request['user']) {
    const receipt = await this.repository.findWithEventAndTransaction(id);
    if (!receipt) throw notFound('Receipt not found');
    if (!canManage(user, receipt.event)) throw forbidden('You are not allowed to reject this receipt');
    const updated = await this.repository.reject(id, { confirmedBy: user!.name, note: input.note });
    cacheDeletePrefix('ledger:');
    return updated;
  }

  async status(id: string, student: NonNullable<Express.Request['student']>) {
    const receipt = await this.repository.findStatus(id);
    if (!receipt || receipt.matricNumber.trim().toUpperCase() !== student.matricNumber.trim().toUpperCase()) throw notFound('Receipt not found');
    let ticketQrCode = receipt.ticketQrCode;
    if (receipt.event.hasTickets && !ticketQrCode) {
      ticketQrCode = await generateQR(receipt.id);
      await this.repository.updateTicketQrCode(receipt.id, ticketQrCode);
    }
    return {
      status: receipt.status,
      confirmedAt: receipt.confirmedAt,
      confirmedBy: receipt.confirmedBy,
      note: receipt.note,
      ticketQrCode: receipt.event.hasTickets ? ticketQrCode : null,
      hasTickets: receipt.event.hasTickets,
      eventTitle: receipt.event.title,
      fullName: receipt.fullName,
      matricNumber: receipt.matricNumber,
      extractedAmount: receipt.extractedAmount?.toString() ?? null,
      amountCheckStatus: receipt.amountCheckStatus,
      amountCheckConfidence: receipt.amountCheckConfidence,
      amountCheckNote: receipt.amountCheckNote,
      amountCheckedAt: receipt.amountCheckedAt,
      isClaimed: receipt.isClaimed,
      claimedAt: receipt.claimedAt,
      claimedBy: receipt.claimedBy,
    };
  }

  async myTickets(student: NonNullable<Express.Request['student']>) {
    const receipts = await this.repository.findConfirmedTicketsByMatric(student.matricNumber);
    const tickets = [];
    for (const receipt of receipts) {
      let qr = receipt.ticketQrCode;
      if (!qr) {
        qr = await generateQR(receipt.id);
        await this.repository.updateTicketQrCode(receipt.id, qr);
      }
      tickets.push({
        receiptId: receipt.id,
        eventTitle: receipt.event.title,
        eventSlug: receipt.event.slug,
        amount: receipt.event.amount.toString(),
        fullName: receipt.fullName,
        matricNumber: receipt.matricNumber,
        ticketQrCode: qr,
        isClaimed: receipt.isClaimed,
        claimedAt: receipt.claimedAt,
        claimedBy: receipt.claimedBy,
      });
    }
    return { tickets };
  }

  async claim(codeInput: string | undefined, user: Express.Request['user']) {
    if (!codeInput?.trim()) throw badRequest('code is required');
    const normalized = codeInput.trim().replace(/-/g, '');
    let receipt = normalized.length === 8 ? await this.repository.findTicketByShortCode(normalized) : await this.repository.findTicketById(normalized);
    if (receipt && !receipt.event.hasTickets) receipt = null;
    if (!receipt) throw notFound('Ticket not found');
    if (receipt.status === 'rejected') throw forbidden('This ticket has been rejected - student should contact fin sec');
    if (receipt.status !== 'confirmed') throw forbidden('Payment has not been confirmed yet');
    if (!canManage(user, receipt.event)) throw forbidden('You are not allowed to claim this ticket');
    if (receipt.isClaimed) return { alreadyClaimed: true, receipt: { fullName: receipt.fullName, matricNumber: receipt.matricNumber, claimedBy: receipt.claimedBy, claimedAt: receipt.claimedAt } };

    const result = await this.repository.claim(receipt.id, user!.name);
    if (result.count === 0) {
      const current = await this.repository.findById(receipt.id);
      return { alreadyClaimed: true, receipt: { fullName: current?.fullName ?? receipt.fullName, matricNumber: current?.matricNumber ?? receipt.matricNumber, claimedBy: current?.claimedBy ?? receipt.claimedBy, claimedAt: current?.claimedAt ?? receipt.claimedAt } };
    }
    const updated = await this.repository.findById(receipt.id);
    return { alreadyClaimed: false, receipt: { fullName: updated!.fullName, matricNumber: updated!.matricNumber, claimedBy: updated!.claimedBy, claimedAt: updated!.claimedAt } };
  }
}

export const paymentReceiptService = new PaymentReceiptService(paymentReceiptRepository);
