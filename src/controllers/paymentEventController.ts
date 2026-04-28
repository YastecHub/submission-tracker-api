import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { uniquePaymentSlug } from '../utils/slugGenerator';
import { generateQR } from '../utils/qrGenerator';

export async function listPaymentEvents(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const [events, total, statusGroups] = await Promise.all([
    prisma.paymentEvent.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { receipts: true } } },
      skip,
      take: limit,
    }),
    prisma.paymentEvent.count({ where: { isDeleted: false } }),
    prisma.paymentReceipt.groupBy({
      by: ['eventId', 'status'],
      _count: { id: true },
    }),
  ]);

  // Build a map: eventId → { confirmed, rejected, pending }
  const statusMap = new Map<string, { confirmed: number; rejected: number; pending: number }>();
  for (const g of statusGroups) {
    if (!statusMap.has(g.eventId)) {
      statusMap.set(g.eventId, { confirmed: 0, rejected: 0, pending: 0 });
    }
    const entry = statusMap.get(g.eventId)!;
    if (g.status === 'confirmed') entry.confirmed = g._count.id;
    if (g.status === 'rejected') entry.rejected = g._count.id;
    if (g.status === 'pending') entry.pending = g._count.id;
  }

  const eventsWithStats = events.map((event) => {
    const stats = statusMap.get(event.id) ?? { confirmed: 0, rejected: 0, pending: 0 };
    return {
      ...event,
      totalReceipts: event._count.receipts,
      confirmedCount: stats.confirmed,
      rejectedCount: stats.rejected,
      pendingCount: stats.pending,
    };
  });

  res.json({ events: eventsWithStats, total, page, totalPages: Math.ceil(total / limit) });
}

export async function createPaymentEvent(req: Request, res: Response): Promise<void> {
  const { title, description, amount, accountNumber, accountName, bankName, deadline, hasTickets } =
    req.body as {
      title?: string;
      description?: string;
      amount?: string;
      accountNumber?: string;
      accountName?: string;
      bankName?: string;
      deadline?: string;
      hasTickets?: boolean;
    };

  if (!title || !amount || !accountNumber || !accountName || !bankName || !deadline) {
    res.status(400).json({
      error: 'title, amount, accountNumber, accountName, bankName, and deadline are required',
    });
    return;
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  const slug = await uniquePaymentSlug(title);

  const event = await prisma.paymentEvent.create({
    data: {
      slug,
      title,
      description: description ?? null,
      amount: new Prisma.Decimal(parsedAmount),
      accountNumber,
      accountName,
      bankName,
      deadline: new Date(deadline),
      hasTickets: !!hasTickets,
      createdBy: req.user!.id,
    },
  });

  res.status(201).json(event);
}

export async function getPaymentEventBySlug(req: Request, res: Response): Promise<void> {
  const slug = req.params.slug as string;

  const event = await prisma.paymentEvent.findUnique({
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

  if (!event || event.isDeleted) {
    res.status(404).json({ error: 'Payment event not found' });
    return;
  }

  res.json(event);
}

export async function getPaymentEventById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const event = await prisma.paymentEvent.findFirst({
    where: { id, isDeleted: false },
    include: { _count: { select: { receipts: true } } },
  });

  if (!event) {
    res.status(404).json({ error: 'Payment event not found' });
    return;
  }

  const [confirmedCount, rejectedCount, pendingCount] = await Promise.all([
    prisma.paymentReceipt.count({ where: { eventId: id, status: 'confirmed' } }),
    prisma.paymentReceipt.count({ where: { eventId: id, status: 'rejected' } }),
    prisma.paymentReceipt.count({ where: { eventId: id, status: 'pending' } }),
  ]);

  res.json({
    ...event,
    totalReceipts: event._count.receipts,
    confirmedCount,
    rejectedCount,
    pendingCount,
  });
}

export async function updatePaymentEvent(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const event = await prisma.paymentEvent.findFirst({
    where: { id, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Payment event not found' });
    return;
  }

  const updates: { hasTickets?: boolean; description?: string | null } = {};

  if (req.body.hasTickets !== undefined) {
    updates.hasTickets = !!req.body.hasTickets;
  }
  if (req.body.description !== undefined) {
    updates.description = req.body.description?.trim() || null;
  }

  const updated = await prisma.paymentEvent.update({
    where: { id },
    data: updates,
  });

  // Backfill QR codes for already-confirmed receipts when tickets are first enabled
  if (!event.hasTickets && updates.hasTickets === true) {
    const pending = await prisma.paymentReceipt.findMany({
      where: { eventId: id, status: 'confirmed', ticketQrCode: null },
      select: { id: true },
    });
    for (const r of pending) {
      const qr = await generateQR(r.id);
      await prisma.paymentReceipt.update({ where: { id: r.id }, data: { ticketQrCode: qr } });
    }
  }

  res.json(updated);
}

export async function toggleClosePaymentEvent(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const event = await prisma.paymentEvent.findFirst({
    where: { id, createdBy: req.user!.id, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Payment event not found or not authorised' });
    return;
  }

  const updated = await prisma.paymentEvent.update({
    where: { id },
    data: { isClosed: !event.isClosed },
  });

  res.json(updated);
}

export async function extendPaymentEvent(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { deadline } = req.body as { deadline?: string };

  if (!deadline) {
    res.status(400).json({ error: 'deadline is required' });
    return;
  }

  const newDeadline = new Date(deadline);
  if (isNaN(newDeadline.getTime())) {
    res.status(400).json({ error: 'deadline must be a valid date' });
    return;
  }

  if (newDeadline <= new Date()) {
    res.status(400).json({ error: 'deadline must be in the future' });
    return;
  }

  const event = await prisma.paymentEvent.findFirst({
    where: { id, createdBy: req.user!.id, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Payment event not found or not authorised' });
    return;
  }

  const updated = await prisma.paymentEvent.update({
    where: { id },
    data: { deadline: newDeadline, isClosed: false },
  });

  res.json(updated);
}

export async function deletePaymentEvent(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const event = await prisma.paymentEvent.findFirst({
    where: { id, createdBy: req.user!.id, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Payment event not found or not authorised' });
    return;
  }

  await prisma.paymentEvent.update({ where: { id }, data: { isDeleted: true } });
  res.json({ message: 'Payment event deleted' });
}
