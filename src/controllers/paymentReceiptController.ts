import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { uploadImageBuffer } from '../lib/cloudinary';
import { generateQR } from '../utils/qrGenerator';
import { exportPaymentReceipts } from '../utils/excelExporter';
import { checkReceiptAmountInBackground } from '../utils/receiptAmountChecker';

export async function submitPaymentReceipt(req: Request, res: Response): Promise<void> {
  const { eventId, fullName, matricNumber, level } = req.body as {
    eventId?: string;
    fullName?: string;
    matricNumber?: string;
    level?: string;
  };

  if (!eventId || !fullName || !matricNumber) {
    res.status(400).json({ error: 'eventId, fullName, and matricNumber are required' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'Payment receipt image is required' });
    return;
  }

  const event = await prisma.paymentEvent.findUnique({ where: { id: eventId } });
  if (!event || event.isDeleted) {
    res.status(404).json({ error: 'Payment event not found' });
    return;
  }

  if (event.isClosed || new Date() > new Date(event.deadline)) {
    res.status(403).json({ error: 'Payment event is closed or deadline has passed' });
    return;
  }

  const existing = await prisma.paymentReceipt.findUnique({
    where: { matricNumber_eventId: { matricNumber: matricNumber.toUpperCase(), eventId } },
  });
  if (existing) {
    res.status(409).json({ error: 'You have already submitted a receipt for this payment' });
    return;
  }

  let receiptUrl: string;
  let receiptPublicId: string;
  try {
    const result = await uploadImageBuffer(req.file.buffer, 'payment-receipts');
    receiptUrl = result.url;
    receiptPublicId = result.publicId;
  } catch {
    res.status(500).json({ error: 'Failed to upload receipt image. Please try again.' });
    return;
  }

  const receipt = await prisma.paymentReceipt.create({
    data: {
      eventId,
      fullName: fullName.trim(),
      matricNumber: matricNumber.trim().toUpperCase(),
      level: level ?? null,
      receiptUrl,
      receiptPublicId,
    },
  });

  let responseReceipt = receipt;
  if (event.hasTickets && !receipt.ticketQrCode) {
    const ticketQrCode = await generateQR(receipt.id);
    responseReceipt = await prisma.paymentReceipt.update({
      where: { id: receipt.id },
      data: { ticketQrCode },
    });
  }

  res.status(201).json({ receipt: responseReceipt });

  void checkReceiptAmountInBackground({
    receiptId: receipt.id,
    receiptUrl,
    expectedAmount: event.amount,
  }).catch((err) => console.error('[receipt amount check]', err));
}

export async function getPaymentReceipts(req: Request, res: Response): Promise<void> {
  const eventId = req.params.eventId as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const search = ((req.query.search as string) ?? '').trim();
  const statusFilter = (req.query.status as string) ?? '';
  const skip = (page - 1) * limit;

  const event = await prisma.paymentEvent.findFirst({ where: { id: eventId, isDeleted: false } });
  if (!event) {
    res.status(404).json({ error: 'Payment event not found' });
    return;
  }

  const effectiveSearch = search.length >= 2 ? search : '';

  const searchWhere: Prisma.PaymentReceiptWhereInput = effectiveSearch
    ? {
        OR: [
          { fullName: { contains: effectiveSearch, mode: Prisma.QueryMode.insensitive } },
          { matricNumber: { contains: effectiveSearch, mode: Prisma.QueryMode.insensitive } },
        ],
      }
    : {};

  const statusWhere: Prisma.PaymentReceiptWhereInput =
    statusFilter && ['pending', 'confirmed', 'rejected'].includes(statusFilter)
      ? { status: statusFilter as 'pending' | 'confirmed' | 'rejected' }
      : {};

  const where: Prisma.PaymentReceiptWhereInput = { eventId, ...searchWhere, ...statusWhere };

  const [receipts, total, confirmedTotal, rejectedTotal, pendingTotal, claimedTotal] = await Promise.all([
    prisma.paymentReceipt.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.paymentReceipt.count({ where }),
    prisma.paymentReceipt.count({ where: { eventId, status: 'confirmed' } }),
    prisma.paymentReceipt.count({ where: { eventId, status: 'rejected' } }),
    prisma.paymentReceipt.count({ where: { eventId, status: 'pending' } }),
    prisma.paymentReceipt.count({ where: { eventId, isClaimed: true } }),
  ]);

  res.json({
    receipts,
    total,
    confirmedTotal,
    rejectedTotal,
    pendingTotal,
    claimedTotal,
    page,
    totalPages: Math.ceil(total / limit),
    limit,
  });
}

export async function exportPaymentReceiptsToExcel(req: Request, res: Response): Promise<void> {
  const eventId = req.params.eventId as string;

  const event = await prisma.paymentEvent.findFirst({
    where: { id: eventId, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Payment event not found' });
    return;
  }

  const receipts = await prisma.paymentReceipt.findMany({
    where: { eventId },
    orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
  });

  const { buffer, filename } = exportPaymentReceipts(receipts, event);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buffer);
}

export async function confirmPaymentReceipt(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { note } = req.body as { note?: string };

  const receipt = await prisma.paymentReceipt.findUnique({
    where: { id },
    include: { event: true, transaction: true },
  });
  if (!receipt) {
    res.status(404).json({ error: 'Receipt not found' });
    return;
  }

  const wasConfirmed = receipt.status === 'confirmed';
  const now = new Date();

  const ticketQrCode =
    receipt.event.hasTickets && !receipt.ticketQrCode
      ? await generateQR(receipt.id)
      : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedReceipt = await tx.paymentReceipt.update({
      where: { id },
      data: {
        status: 'confirmed',
        confirmedAt: now,
        confirmedBy: req.user!.name,
        note: note ?? null,
        ...(ticketQrCode ? { ticketQrCode } : {}),
      },
    });

    if (!wasConfirmed) {
      if (receipt.transaction && receipt.transaction.isDeleted) {
        await tx.transaction.update({
          where: { id: receipt.transaction.id },
          data: { isDeleted: false, occurredAt: now, recordedBy: req.user!.id },
        });
      } else if (!receipt.transaction) {
        await tx.transaction.create({
          data: {
            type: 'credit',
            amount: receipt.event.amount,
            description: `Payment: ${receipt.event.title} — ${receipt.matricNumber}`,
            category: 'Dues',
            occurredAt: now,
            recordedBy: req.user!.id,
            receiptId: receipt.id,
          },
        });
      }
    }

    return updatedReceipt;
  });

  res.json(updated);
}

export async function rejectPaymentReceipt(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { note } = req.body as { note?: string };

  const receipt = await prisma.paymentReceipt.findUnique({
    where: { id },
    include: { transaction: true },
  });
  if (!receipt) {
    res.status(404).json({ error: 'Receipt not found' });
    return;
  }

  const wasConfirmed = receipt.status === 'confirmed';
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const updatedReceipt = await tx.paymentReceipt.update({
      where: { id },
      data: {
        status: 'rejected',
        confirmedAt: now,
        confirmedBy: req.user!.name,
        note: note ?? null,
      },
    });

    if (wasConfirmed && receipt.transaction && !receipt.transaction.isDeleted) {
      await tx.transaction.update({
        where: { id: receipt.transaction.id },
        data: { isDeleted: true },
      });
    }

    return updatedReceipt;
  });

  res.json(updated);
}

export async function getPaymentReceiptStatus(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const receipt = await prisma.paymentReceipt.findUnique({
    where: { id },
    include: { event: { select: { title: true, hasTickets: true } } },
  });

  if (!receipt) {
    res.status(404).json({ error: 'Receipt not found' });
    return;
  }

  let ticketQrCode = receipt.ticketQrCode;
  if (receipt.event.hasTickets && !ticketQrCode) {
    ticketQrCode = await generateQR(receipt.id);
    await prisma.paymentReceipt.update({
      where: { id },
      data: { ticketQrCode },
    });
  }

  res.json({
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
  });
}

export async function getMyTickets(req: Request, res: Response): Promise<void> {
  const { matricNumber } = req.query as { matricNumber?: string };

  if (!matricNumber || !matricNumber.trim()) {
    res.status(400).json({ error: 'matricNumber is required' });
    return;
  }

  const normalized = matricNumber.trim().toUpperCase();

  const receipts = await prisma.paymentReceipt.findMany({
    where: {
      matricNumber: normalized,
      status: 'confirmed',
      event: { hasTickets: true, isDeleted: false },
    },
    include: { event: { select: { title: true, slug: true, amount: true, hasTickets: true } } },
    orderBy: { confirmedAt: 'desc' },
  });

  const tickets = [];
  for (const r of receipts) {
    let qr = r.ticketQrCode;
    if (!qr) {
      qr = await generateQR(r.id);
      await prisma.paymentReceipt.update({ where: { id: r.id }, data: { ticketQrCode: qr } });
    }
    tickets.push({
      receiptId: r.id,
      eventTitle: r.event.title,
      eventSlug: r.event.slug,
      amount: r.event.amount.toString(),
      fullName: r.fullName,
      matricNumber: r.matricNumber,
      ticketQrCode: qr,
      isClaimed: r.isClaimed,
      claimedAt: r.claimedAt,
      claimedBy: r.claimedBy,
    });
  }

  res.json({ tickets });
}

export async function claimPaymentReceipt(req: Request, res: Response): Promise<void> {
  const { code } = req.body as { code?: string };

  if (!code || !code.trim()) {
    res.status(400).json({ error: 'code is required' });
    return;
  }

  const normalized = code.trim().replace(/-/g, '');
  let receipt;

  if (normalized.length === 8) {
    receipt = await prisma.paymentReceipt.findFirst({
      where: {
        id: { startsWith: normalized.toLowerCase() },
        event: { hasTickets: true },
      },
      include: { event: true },
    });
  } else {
    receipt = await prisma.paymentReceipt.findUnique({
      where: { id: normalized },
      include: { event: true },
    });
    if (receipt && !receipt.event.hasTickets) receipt = null;
  }

  if (!receipt) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  if (receipt.status === 'rejected') {
    res.status(403).json({ error: 'This ticket has been rejected — student should contact fin sec' });
    return;
  }

  if (receipt.status !== 'confirmed') {
    res.status(403).json({ error: 'Payment has not been confirmed yet' });
    return;
  }

  if (receipt.isClaimed) {
    res.json({
      alreadyClaimed: true,
      receipt: {
        fullName: receipt.fullName,
        matricNumber: receipt.matricNumber,
        claimedBy: receipt.claimedBy,
        claimedAt: receipt.claimedAt,
      },
    });
    return;
  }

  const now = new Date();
  const updated = await prisma.paymentReceipt.update({
    where: { id: receipt.id },
    data: {
      isClaimed: true,
      claimedAt: now,
      claimedBy: req.user!.name,
    },
  });

  res.json({
    alreadyClaimed: false,
    receipt: {
      fullName: updated.fullName,
      matricNumber: updated.matricNumber,
      claimedBy: updated.claimedBy,
      claimedAt: updated.claimedAt,
    },
  });
}
