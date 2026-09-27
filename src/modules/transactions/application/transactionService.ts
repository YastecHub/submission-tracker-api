import { Prisma, TransactionType } from '@prisma/client';
import { uploadImageBuffer, destroyImage } from '../../../lib/cloudinary';
import { AppError, badRequest, notFound } from '../../../shared/errors/AppError';
import { transactionRepository, TransactionRepository, TransactionWithRelations } from '../infrastructure/transactionRepository';
import { cacheDeletePrefix, cacheGet, cacheSet } from '../../../utils/cache';

const AMOUNT_MAX = 10_000_000_000;

interface SerializedTransaction {
  id: string;
  type: TransactionType;
  amount: string;
  description: string;
  category: string | null;
  occurredAt: Date;
  proofUrl: string | null;
  recorderName: string | null;
  recorderRole: string | null;
  receiptId: string | null;
  paymentEventId: string | null;
  paymentEventTitle: string | null;
  paymentEventSlug: string | null;
  paymentEventReference: string | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  recordedBy?: string;
}

function parseAmount(raw: unknown): Prisma.Decimal | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const num = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(num) || num <= 0 || num >= AMOUNT_MAX) return null;
  return new Prisma.Decimal(num.toFixed(2));
}

function parseType(raw: unknown): TransactionType | null {
  return raw === 'credit' || raw === 'debit' ? raw : null;
}

function parseOccurredAt(raw: unknown): Date | null {
  if (!raw) return null;
  const date = new Date(raw as string);
  if (Number.isNaN(date.getTime())) return null;
  if (date > new Date(Date.now() + 24 * 60 * 60 * 1000)) return null;
  return date;
}

function serializeTransaction(t: TransactionWithRelations, options: { includeRecordedBy?: boolean; includeRecorderName?: boolean } = {}): SerializedTransaction {
  const includeRecorderName = options.includeRecorderName ?? true;
  const paymentEvent = t.receipt?.event ?? null;
  return {
    id: t.id,
    type: t.type,
    amount: t.amount.toString(),
    description: t.description,
    category: t.category,
    occurredAt: t.occurredAt,
    proofUrl: t.proofUrl,
    recorderName: includeRecorderName ? t.recorder?.name ?? null : null,
    recorderRole: includeRecorderName ? t.recorder?.role ?? null : null,
    receiptId: t.receiptId,
    paymentEventId: paymentEvent?.id ?? null,
    paymentEventTitle: paymentEvent?.title ?? null,
    paymentEventSlug: paymentEvent?.slug ?? null,
    paymentEventReference: paymentEvent?.slug ?? null,
    isDeleted: t.isDeleted,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    ...(options.includeRecordedBy ? { recordedBy: t.recordedBy } : {}),
  };
}

function sumCredits(transactions: SerializedTransaction[]): string {
  return transactions.reduce((acc, transaction) => transaction.type === 'credit' ? acc.plus(transaction.amount) : acc, new Prisma.Decimal(0)).toString();
}

function groupTransactionsByPaymentEvent(transactions: SerializedTransaction[]) {
  const groups = new Map<string, { paymentEventId: string; paymentEventTitle: string; paymentEventSlug: string; paymentEventReference: string; transactions: SerializedTransaction[] }>();
  const ungroupedTransactions: SerializedTransaction[] = [];
  for (const transaction of transactions) {
    if (!transaction.paymentEventId || !transaction.paymentEventTitle) {
      ungroupedTransactions.push(transaction);
      continue;
    }
    if (!groups.has(transaction.paymentEventId)) {
      groups.set(transaction.paymentEventId, {
        paymentEventId: transaction.paymentEventId,
        paymentEventTitle: transaction.paymentEventTitle,
        paymentEventSlug: transaction.paymentEventSlug ?? transaction.paymentEventReference ?? transaction.paymentEventId,
        paymentEventReference: transaction.paymentEventReference ?? transaction.paymentEventSlug ?? transaction.paymentEventId,
        transactions: [],
      });
    }
    groups.get(transaction.paymentEventId)!.transactions.push(transaction);
  }
  return {
    paymentEventGroups: Array.from(groups.values()).map((group) => ({
      paymentEventId: group.paymentEventId,
      paymentEventTitle: group.paymentEventTitle,
      paymentEventSlug: group.paymentEventSlug,
      paymentEventReference: group.paymentEventReference,
      totalCollected: sumCredits(group.transactions),
      transactionCount: group.transactions.length,
      transactions: group.transactions,
    })),
    ungroupedTransactions,
  };
}

export class TransactionService {
  constructor(private readonly repository: TransactionRepository) {}

  private async totals(where: Prisma.TransactionWhereInput) {
    const [creditAgg, debitAgg, count] = await Promise.all([
      this.repository.aggregateCredits(where),
      this.repository.aggregateDebits(where),
      this.repository.count(where),
    ]);
    const totalCredits = creditAgg._sum.amount ?? new Prisma.Decimal(0);
    const totalDebits = debitAgg._sum.amount ?? new Prisma.Decimal(0);
    return { balance: totalCredits.minus(totalDebits).toString(), totalCredits: totalCredits.toString(), totalDebits: totalDebits.toString(), transactionCount: count };
  }

  async ledger(query: { page?: string; limit?: string; type?: string; category?: string }) {
    const page = Math.max(1, parseInt(query.page ?? '') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '') || 50));
    const typeFilter = parseType(query.type);
    const category = (query.category ?? '').trim();
    const cacheKey = `ledger:${page}:${limit}:${typeFilter ?? 'all'}:${category.toLowerCase()}`;
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return cached;
    const where: Prisma.TransactionWhereInput = { isDeleted: false, ...(typeFilter ? { type: typeFilter } : {}), ...(category ? { category: { equals: category, mode: Prisma.QueryMode.insensitive } } : {}) };
    const [transactions, totals] = await Promise.all([this.repository.findPage(where, (page - 1) * limit, limit), this.totals(where)]);
    const serializedTransactions = transactions.map((t) => serializeTransaction(t, { includeRecorderName: true }));
    const result = { ...totals, transactions: serializedTransactions, ...groupTransactionsByPaymentEvent(serializedTransactions), page, limit, totalPages: Math.ceil(totals.transactionCount / limit) };
    cacheSet(cacheKey, result, 10_000);
    return result;
  }

  async verifyMatric(matricNumberInput?: string) {
    if (!matricNumberInput?.trim()) throw badRequest('matricNumber is required');
    const matricNumber = matricNumberInput.trim().toUpperCase();
    const [submission, receipt] = await Promise.all([this.repository.findSubmissionNameByMatric(matricNumber), this.repository.findReceiptNameByMatric(matricNumber)]);
    const found = submission ?? receipt;
    if (!found) throw new AppError(404, 'Matric number not found in class records');
    return { verified: true, displayName: found.fullName, matricNumber };
  }

  async adminList(query: { page?: string; limit?: string; type?: string; includeDeleted?: string; search?: string }) {
    const page = Math.max(1, parseInt(query.page ?? '') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '') || 50));
    const typeFilter = parseType(query.type);
    const search = (query.search ?? '').trim();
    const where: Prisma.TransactionWhereInput = {
      ...(query.includeDeleted === 'true' ? {} : { isDeleted: false }),
      ...(typeFilter ? { type: typeFilter } : {}),
      ...(search ? { OR: [{ description: { contains: search, mode: Prisma.QueryMode.insensitive } }, { category: { contains: search, mode: Prisma.QueryMode.insensitive } }] } : {}),
    };
    const [transactions, totals] = await Promise.all([this.repository.findPage(where, (page - 1) * limit, limit), this.totals(where)]);
    return { ...totals, transactions: transactions.map((t) => serializeTransaction(t, { includeRecordedBy: true, includeRecorderName: true })), page, limit, totalPages: Math.ceil(totals.transactionCount / limit) };
  }

  async create(input: Record<string, unknown>, file: Express.Multer.File | undefined, userId: string) {
    const parsedType = parseType(input.type);
    const parsedAmount = parseAmount(input.amount);
    const parsedOccurredAt = parseOccurredAt(input.occurredAt);
    const description = typeof input.description === 'string' ? input.description : '';
    const category = typeof input.category === 'string' ? input.category : undefined;
    if (!parsedType) throw badRequest('type must be "credit" or "debit"');
    if (!parsedAmount) throw badRequest('amount must be a positive number under 10,000,000,000');
    if (!description || description.trim().length === 0 || description.length > 500) throw badRequest('description is required and must be 1-500 chars');
    if (category && category.length > 50) throw badRequest('category must be 50 chars or less');
    if (!parsedOccurredAt) throw badRequest('occurredAt must be a valid date, not more than 1 day in the future');

    const proof = await this.uploadProof(file);
    const created = await this.repository.create({ type: parsedType, amount: parsedAmount, description: description.trim(), category: category?.trim() || null, occurredAt: parsedOccurredAt, proofUrl: proof.proofUrl, proofPublicId: proof.proofPublicId, recordedBy: userId });
    cacheDeletePrefix('ledger:');
    return serializeTransaction(created, { includeRecordedBy: true, includeRecorderName: true });
  }

  async update(id: string, input: Record<string, unknown>, file: Express.Multer.File | undefined) {
    const existing = await this.repository.findById(id);
    if (!existing) throw notFound('Transaction not found');
    if (existing.receiptId) throw new AppError(409, 'Auto-created transactions from payment receipts cannot be edited directly');
    const updates: Prisma.TransactionUpdateInput = {};
    if (input.type !== undefined) {
      const parsedType = parseType(input.type);
      if (!parsedType) throw badRequest('type must be "credit" or "debit"');
      updates.type = parsedType;
    }
    if (input.amount !== undefined) {
      const parsedAmount = parseAmount(input.amount);
      if (!parsedAmount) throw badRequest('amount must be a positive number under 10,000,000,000');
      updates.amount = parsedAmount;
    }
    if (input.description !== undefined) {
      const description = String(input.description);
      if (description.trim().length === 0 || description.length > 500) throw badRequest('description must be 1-500 chars');
      updates.description = description.trim();
    }
    if (input.category !== undefined) {
      const category = String(input.category);
      if (category.length > 50) throw badRequest('category must be 50 chars or less');
      updates.category = category.trim() || null;
    }
    if (input.occurredAt !== undefined) {
      const occurredAt = parseOccurredAt(input.occurredAt);
      if (!occurredAt) throw badRequest('occurredAt must be a valid date, not more than 1 day in the future');
      updates.occurredAt = occurredAt;
    }
    if (file) {
      const proof = await this.uploadProof(file);
      updates.proofUrl = proof.proofUrl;
      updates.proofPublicId = proof.proofPublicId;
      if (existing.proofPublicId) await destroyImage(existing.proofPublicId);
    } else if (input.removeProof === 'true' && existing.proofPublicId) {
      await destroyImage(existing.proofPublicId);
      updates.proofUrl = null;
      updates.proofPublicId = null;
    }
    const updated = await this.repository.update(id, updates);
    cacheDeletePrefix('ledger:');
    return serializeTransaction(updated, { includeRecordedBy: true, includeRecorderName: true });
  }

  async delete(id: string) {
    const existing = await this.repository.findById(id);
    if (!existing) throw notFound('Transaction not found');
    if (existing.receiptId) throw new AppError(409, 'Auto-created transactions cannot be deleted directly. Reject the underlying payment receipt instead.');
    await this.repository.softDelete(id);
    cacheDeletePrefix('ledger:');
    return { ok: true };
  }

  private async uploadProof(file: Express.Multer.File | undefined) {
    if (!file) return { proofUrl: null as string | null, proofPublicId: null as string | null };
    try {
      const uploaded = await uploadImageBuffer(file.buffer, 'ledger-proofs');
      return { proofUrl: uploaded.url, proofPublicId: uploaded.publicId };
    } catch {
      throw new AppError(500, 'Failed to upload proof image');
    }
  }
}

export const transactionService = new TransactionService(transactionRepository);
