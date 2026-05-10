import { Request, Response } from 'express';
import { Prisma, TransactionType } from '@prisma/client';
import prisma from '../lib/prisma';
import { uploadImageBuffer, destroyImage } from '../lib/cloudinary';

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

interface PaymentEventTransactionGroup {
  paymentEventId: string;
  paymentEventTitle: string;
  paymentEventSlug: string;
  paymentEventReference: string;
  totalCollected: string;
  transactionCount: number;
  transactions: SerializedTransaction[];
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
  const d = new Date(raw as string);
  if (Number.isNaN(d.getTime())) return null;
  const maxFuture = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (d > maxFuture) return null;
  return d;
}

function serializeTransaction(
  t: Prisma.TransactionGetPayload<{
    include: {
      recorder: { select: { name: true; role: true } };
      receipt: { include: { event: { select: { id: true; slug: true; title: true } } } };
    };
  }>,
  { includeRecordedBy = false, includeRecorderName = true }: { includeRecordedBy?: boolean; includeRecorderName?: boolean } = {}
): SerializedTransaction {
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
    ...(includeRecordedBy ? { recordedBy: t.recordedBy } : {}),
  };
}

function sumCredits(transactions: SerializedTransaction[]): string {
  const total = transactions.reduce((acc, transaction) => {
    if (transaction.type !== 'credit') return acc;
    return acc.plus(transaction.amount);
  }, new Prisma.Decimal(0));
  return total.toString();
}

function groupTransactionsByPaymentEvent(transactions: SerializedTransaction[]): {
  paymentEventGroups: PaymentEventTransactionGroup[];
  ungroupedTransactions: SerializedTransaction[];
} {
  const groups = new Map<
    string,
    {
      paymentEventId: string;
      paymentEventTitle: string;
      paymentEventSlug: string;
      paymentEventReference: string;
      transactions: SerializedTransaction[];
    }
  >();
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

  const paymentEventGroups = Array.from(groups.values()).map((group) => ({
    paymentEventId: group.paymentEventId,
    paymentEventTitle: group.paymentEventTitle,
    paymentEventSlug: group.paymentEventSlug,
    paymentEventReference: group.paymentEventReference,
    totalCollected: sumCredits(group.transactions),
    transactionCount: group.transactions.length,
    transactions: group.transactions,
  }));

  return { paymentEventGroups, ungroupedTransactions };
}

async function computeLedgerTotals(where: Prisma.TransactionWhereInput) {
  const [creditAgg, debitAgg, count] = await Promise.all([
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { ...where, type: 'credit' } }),
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { ...where, type: 'debit' } }),
    prisma.transaction.count({ where }),
  ]);
  const totalCredits = creditAgg._sum.amount ?? new Prisma.Decimal(0);
  const totalDebits = debitAgg._sum.amount ?? new Prisma.Decimal(0);
  const balance = totalCredits.minus(totalDebits);
  return {
    balance: balance.toString(),
    totalCredits: totalCredits.toString(),
    totalDebits: totalDebits.toString(),
    transactionCount: count,
  };
}

export async function getLedger(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const skip = (page - 1) * limit;
  const typeFilter = parseType(req.query.type);
  const category = ((req.query.category as string) ?? '').trim();

  const where: Prisma.TransactionWhereInput = {
    isDeleted: false,
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(category ? { category: { equals: category, mode: Prisma.QueryMode.insensitive } } : {}),
  };

  const [transactions, totals] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
      include: {
        recorder: { select: { name: true, role: true } },
        receipt: { include: { event: { select: { id: true, slug: true, title: true } } } },
      },
    }),
    computeLedgerTotals({ isDeleted: false }),
  ]);

  const serializedTransactions = transactions.map((t) => serializeTransaction(t, { includeRecorderName: true }));
  const { paymentEventGroups, ungroupedTransactions } = groupTransactionsByPaymentEvent(serializedTransactions);

  res.json({
    ...totals,
    transactions: serializedTransactions,
    paymentEventGroups,
    ungroupedTransactions,
    page,
    limit,
    totalPages: Math.ceil(totals.transactionCount / limit),
  });
}

export async function verifyMatric(req: Request, res: Response): Promise<void> {
  const { matricNumber } = req.body as { matricNumber?: string };
  if (!matricNumber || !matricNumber.trim()) {
    res.status(400).json({ error: 'matricNumber is required' });
    return;
  }

  const normalized = matricNumber.trim().toUpperCase();

  const [submission, receipt] = await Promise.all([
    prisma.submission.findFirst({
      where: { matricNumber: normalized },
      select: { fullName: true },
      orderBy: { submittedAt: 'desc' },
    }),
    prisma.paymentReceipt.findFirst({
      where: { matricNumber: normalized },
      select: { fullName: true },
      orderBy: { submittedAt: 'desc' },
    }),
  ]);

  const found = submission ?? receipt;
  if (!found) {
    res.status(404).json({ verified: false, error: 'Matric number not found in class records' });
    return;
  }

  res.json({ verified: true, displayName: found.fullName, matricNumber: normalized });
}

export async function listTransactionsAdmin(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const skip = (page - 1) * limit;
  const typeFilter = parseType(req.query.type);
  const includeDeleted = req.query.includeDeleted === 'true';
  const search = ((req.query.search as string) ?? '').trim();

  const where: Prisma.TransactionWhereInput = {
    ...(includeDeleted ? {} : { isDeleted: false }),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(search
      ? {
          OR: [
            { description: { contains: search, mode: Prisma.QueryMode.insensitive } },
            { category: { contains: search, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  };

  const [transactions, totals] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
      include: {
        recorder: { select: { name: true, role: true } },
        receipt: { include: { event: { select: { id: true, slug: true, title: true } } } },
      },
    }),
    computeLedgerTotals({ isDeleted: false }),
  ]);

  res.json({
    ...totals,
    transactions: transactions.map((t) => serializeTransaction(t, { includeRecordedBy: true, includeRecorderName: true })),
    page,
    limit,
    totalPages: Math.ceil(totals.transactionCount / limit),
  });
}

export async function createTransaction(req: Request, res: Response): Promise<void> {
  const { type, description, category, occurredAt } = req.body as {
    type?: string;
    description?: string;
    category?: string;
    occurredAt?: string;
  };

  const parsedType = parseType(type);
  const parsedAmount = parseAmount(req.body.amount);
  const parsedOccurredAt = parseOccurredAt(occurredAt);

  if (!parsedType) {
    res.status(400).json({ error: 'type must be "credit" or "debit"' });
    return;
  }
  if (!parsedAmount) {
    res.status(400).json({ error: 'amount must be a positive number under 10,000,000,000' });
    return;
  }
  if (!description || description.trim().length === 0 || description.length > 500) {
    res.status(400).json({ error: 'description is required and must be 1-500 chars' });
    return;
  }
  if (category && category.length > 50) {
    res.status(400).json({ error: 'category must be 50 chars or less' });
    return;
  }
  if (!parsedOccurredAt) {
    res.status(400).json({ error: 'occurredAt must be a valid date, not more than 1 day in the future' });
    return;
  }

  let proofUrl: string | null = null;
  let proofPublicId: string | null = null;
  if (req.file) {
    try {
      const uploaded = await uploadImageBuffer(req.file.buffer, 'ledger-proofs');
      proofUrl = uploaded.url;
      proofPublicId = uploaded.publicId;
    } catch {
      res.status(500).json({ error: 'Failed to upload proof image' });
      return;
    }
  }

  const created = await prisma.transaction.create({
    data: {
      type: parsedType,
      amount: parsedAmount,
      description: description.trim(),
      category: category?.trim() || null,
      occurredAt: parsedOccurredAt,
      proofUrl,
      proofPublicId,
      recordedBy: req.user!.id,
    },
    include: {
      recorder: { select: { name: true, role: true } },
      receipt: { include: { event: { select: { id: true, slug: true, title: true } } } },
    },
  });

  res.status(201).json(serializeTransaction(created, { includeRecordedBy: true, includeRecorderName: true }));
}

export async function updateTransaction(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }
  if (existing.receiptId) {
    res.status(409).json({ error: 'Auto-created transactions from payment receipts cannot be edited directly' });
    return;
  }

  const updates: Prisma.TransactionUpdateInput = {};

  if (req.body.type !== undefined) {
    const parsedType = parseType(req.body.type);
    if (!parsedType) {
      res.status(400).json({ error: 'type must be "credit" or "debit"' });
      return;
    }
    updates.type = parsedType;
  }

  if (req.body.amount !== undefined) {
    const parsedAmount = parseAmount(req.body.amount);
    if (!parsedAmount) {
      res.status(400).json({ error: 'amount must be a positive number under 10,000,000,000' });
      return;
    }
    updates.amount = parsedAmount;
  }

  if (req.body.description !== undefined) {
    const d = String(req.body.description);
    if (d.trim().length === 0 || d.length > 500) {
      res.status(400).json({ error: 'description must be 1-500 chars' });
      return;
    }
    updates.description = d.trim();
  }

  if (req.body.category !== undefined) {
    const c = String(req.body.category);
    if (c.length > 50) {
      res.status(400).json({ error: 'category must be 50 chars or less' });
      return;
    }
    updates.category = c.trim() || null;
  }

  if (req.body.occurredAt !== undefined) {
    const parsedOccurredAt = parseOccurredAt(req.body.occurredAt);
    if (!parsedOccurredAt) {
      res.status(400).json({ error: 'occurredAt must be a valid date, not more than 1 day in the future' });
      return;
    }
    updates.occurredAt = parsedOccurredAt;
  }

  if (req.file) {
    try {
      const uploaded = await uploadImageBuffer(req.file.buffer, 'ledger-proofs');
      if (existing.proofPublicId) {
        await destroyImage(existing.proofPublicId);
      }
      updates.proofUrl = uploaded.url;
      updates.proofPublicId = uploaded.publicId;
    } catch {
      res.status(500).json({ error: 'Failed to upload proof image' });
      return;
    }
  } else if (req.body.removeProof === 'true' && existing.proofPublicId) {
    await destroyImage(existing.proofPublicId);
    updates.proofUrl = null;
    updates.proofPublicId = null;
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: updates,
    include: {
      recorder: { select: { name: true, role: true } },
      receipt: { include: { event: { select: { id: true, slug: true, title: true } } } },
    },
  });

  res.json(serializeTransaction(updated, { includeRecordedBy: true, includeRecorderName: true }));
}

export async function deleteTransaction(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }
  if (existing.receiptId) {
    res.status(409).json({
      error: 'Auto-created transactions cannot be deleted directly. Reject the underlying payment receipt instead.',
    });
    return;
  }

  await prisma.transaction.update({
    where: { id },
    data: { isDeleted: true },
  });

  res.json({ ok: true });
}
