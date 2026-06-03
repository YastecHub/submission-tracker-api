import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { generateQR } from '../utils/qrGenerator';
import { exportSubmissions } from '../utils/excelExporter';
import { sendPush } from '../utils/pushNotifier';

const CONFIRM_ALL_MIN_SUBMISSIONS = 100;

export async function createSubmission(req: Request, res: Response): Promise<void> {
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

  const event = await prisma.submissionEvent.findUnique({ where: { id: eventId } });
  if (!event || event.isDeleted) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  if (event.isClosed || new Date() > new Date(event.deadline)) {
    res.status(403).json({ error: 'Event is closed or deadline has passed' });
    return;
  }

  const existing = await prisma.submission.findUnique({
    where: { matricNumber_eventId: { matricNumber, eventId } },
  });
  if (existing) {
    res.status(409).json({ error: 'You have already submitted for this event' });
    return;
  }

  const submission = await prisma.submission.create({
    data: { eventId, fullName, matricNumber, level: level ?? null, qrCode: 'pending' },
  });

  const qrCode = await generateQR(submission.id);

  const updated = await prisma.submission.update({
    where: { id: submission.id },
    data: { qrCode },
  });

  res.status(201).json({ submission: updated });

  // Fire-and-forget push to event creator
  try {
    const creator = await prisma.user.findUnique({
      where: { id: event.createdBy },
      select: { pushSubscription: true },
    });
    if (creator?.pushSubscription) {
      await sendPush(creator.pushSubscription, {
        title: `New submission – ${event.courseCode}`,
        body: `${fullName} (${matricNumber}) just submitted`,
        url: `/dashboard`,
      });
    }
  } catch {
    // push failure should not affect the student response
  }
}

export async function getSubmissions(req: Request, res: Response): Promise<void> {
  const eventId = req.params.eventId as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const search = ((req.query.search as string) ?? '').trim();
  const skip = (page - 1) * limit;

  const event = await prisma.submissionEvent.findFirst({
    where: { id: eventId, isDeleted: false },
  });
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const effectiveSearch = search.length >= 2 ? search : '';

  const searchWhere: Prisma.SubmissionWhereInput = effectiveSearch
    ? {
        OR: [
          { fullName: { contains: effectiveSearch, mode: Prisma.QueryMode.insensitive } },
          { matricNumber: { contains: effectiveSearch, mode: Prisma.QueryMode.insensitive } },
        ],
      }
    : {};

  const where: Prisma.SubmissionWhereInput = { eventId, ...searchWhere };

  const [submissions, total, confirmedTotal, pendingTotal] = await Promise.all([
    prisma.submission.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.submission.count({ where }),
    prisma.submission.count({ where: { eventId, isConfirmed: true } }),
    prisma.submission.count({ where: { eventId, isConfirmed: false } }),
  ]);

  res.json({
    submissions,
    total,
    confirmedTotal,
    pendingTotal,
    page,
    totalPages: Math.ceil(total / limit),
    limit,
  });
}

export async function confirmSubmission(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const submission = await prisma.submission.findUnique({ where: { id } });

  if (!submission) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }

  const updated = await prisma.submission.update({
    where: { id },
    data: { isConfirmed: true, confirmedAt: new Date(), confirmedBy: req.user!.name },
  });

  res.json(updated);
}

export async function scanConfirm(req: Request, res: Response): Promise<void> {
  const { submissionId } = req.body as { submissionId?: string };

  if (!submissionId) {
    res.status(400).json({ error: 'submissionId is required' });
    return;
  }

  const submission = await prisma.submission.findUnique({ where: { id: submissionId } });
  if (!submission) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }

  if (submission.isConfirmed) {
    res.status(200).json({ alreadyConfirmed: true, submission });
    return;
  }

  const updated = await prisma.submission.update({
    where: { id: submissionId },
    data: {
      isConfirmed: true,
      confirmedAt: new Date(),
      confirmedBy: req.user!.name,
    },
  });

  res.json({ alreadyConfirmed: false, submission: updated });
}

export async function confirmAllSubmissions(req: Request, res: Response): Promise<void> {
  const eventId = req.params.eventId as string;

  const event = await prisma.submissionEvent.findFirst({
    where: { id: eventId, isDeleted: false },
  });
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const [total, pendingTotal] = await Promise.all([
    prisma.submission.count({ where: { eventId } }),
    prisma.submission.count({ where: { eventId, isConfirmed: false } }),
  ]);

  if (total < CONFIRM_ALL_MIN_SUBMISSIONS) {
    res.status(400).json({
      error: `Confirm all is only available after at least ${CONFIRM_ALL_MIN_SUBMISSIONS} students have submitted.`,
    });
    return;
  }

  if (pendingTotal === 0) {
    res.json({ confirmedCount: 0, total, pendingTotal: 0 });
    return;
  }

  const result = await prisma.submission.updateMany({
    where: { eventId, isConfirmed: false },
    data: {
      isConfirmed: true,
      confirmedAt: new Date(),
      confirmedBy: req.user!.name,
    },
  });

  res.json({ confirmedCount: result.count, total, pendingTotal: 0 });
}

export async function getSubmissionStatus(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const submission = await prisma.submission.findUnique({
    where: { id },
    select: { isConfirmed: true, confirmedAt: true, confirmedBy: true },
  });
  if (!submission) {
    res.status(404).json({ error: 'Submission not found' });
    return;
  }
  res.json(submission);
}

export async function exportToExcel(req: Request, res: Response): Promise<void> {
  const eventId = req.params.eventId as string;
  const event = await prisma.submissionEvent.findFirst({
    where: { id: eventId, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  // Export only confirmed submissions
  const submissions = await prisma.submission.findMany({
    where: { eventId, isConfirmed: true },
    orderBy: { confirmedAt: 'asc' },
  });

  const { buffer, filename } = exportSubmissions(submissions, event);

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buffer);
}
