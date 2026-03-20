import { Request, Response } from 'express';
import { Readable } from 'stream';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import cloudinary from '../lib/cloudinary';

async function uploadToCloudinary(
  buffer: Buffer,
  folder: string
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

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
    const result = await uploadToCloudinary(req.file.buffer, 'payment-receipts');
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

  res.status(201).json({ receipt });
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

  const searchWhere: Prisma.PaymentReceiptWhereInput = search
    ? {
        OR: [
          { fullName: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { matricNumber: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }
    : {};

  const statusWhere: Prisma.PaymentReceiptWhereInput =
    statusFilter && ['pending', 'confirmed', 'rejected'].includes(statusFilter)
      ? { status: statusFilter as 'pending' | 'confirmed' | 'rejected' }
      : {};

  const where: Prisma.PaymentReceiptWhereInput = { eventId, ...searchWhere, ...statusWhere };

  const [receipts, total, confirmedTotal, rejectedTotal, pendingTotal] = await Promise.all([
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
  ]);

  res.json({
    receipts,
    total,
    confirmedTotal,
    rejectedTotal,
    pendingTotal,
    page,
    totalPages: Math.ceil(total / limit),
    limit,
  });
}

export async function confirmPaymentReceipt(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { note } = req.body as { note?: string };

  const receipt = await prisma.paymentReceipt.findUnique({ where: { id } });
  if (!receipt) {
    res.status(404).json({ error: 'Receipt not found' });
    return;
  }

  const updated = await prisma.paymentReceipt.update({
    where: { id },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmedBy: req.user!.name,
      note: note ?? null,
    },
  });

  res.json(updated);
}

export async function rejectPaymentReceipt(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { note } = req.body as { note?: string };

  const receipt = await prisma.paymentReceipt.findUnique({ where: { id } });
  if (!receipt) {
    res.status(404).json({ error: 'Receipt not found' });
    return;
  }

  const updated = await prisma.paymentReceipt.update({
    where: { id },
    data: {
      status: 'rejected',
      confirmedAt: new Date(),
      confirmedBy: req.user!.name,
      note: note ?? null,
    },
  });

  res.json(updated);
}

export async function getPaymentReceiptStatus(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const receipt = await prisma.paymentReceipt.findUnique({
    where: { id },
    select: { status: true, confirmedAt: true, confirmedBy: true, note: true },
  });

  if (!receipt) {
    res.status(404).json({ error: 'Receipt not found' });
    return;
  }

  res.json(receipt);
}
