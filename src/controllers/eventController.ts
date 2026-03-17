import { Request, Response } from 'express';
import { EventType, Prisma } from '@prisma/client';
import { uniqueSlug } from '../utils/slugGenerator';
import prisma from '../lib/prisma';
import { cacheGet, cacheSet, cacheDelete } from '../utils/cache';

type EventWithCount = Prisma.SubmissionEventGetPayload<{
  include: { _count: { select: { submissions: true } } };
}>;

export async function listEvents(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  // All non-deleted events are visible to every logged-in user
  const [events, total, confirmedGroups] = await Promise.all([
    prisma.submissionEvent.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { submissions: true } } },
      skip,
      take: limit,
    }),
    prisma.submissionEvent.count({ where: { isDeleted: false } }),
    prisma.submission.groupBy({
      by: ['eventId'],
      where: { isConfirmed: true },
      _count: { id: true },
    }),
  ]);

  const confirmedMap = new Map(confirmedGroups.map((g) => [g.eventId, g._count.id]));

  const eventsWithStats = events.map((event: EventWithCount) => {
    const confirmedCount = confirmedMap.get(event.id) ?? 0;
    return {
      ...event,
      totalSubmissions: event._count.submissions,
      confirmedCount,
      pendingCount: event._count.submissions - confirmedCount,
    };
  });

  res.json({ events: eventsWithStats, total, page, totalPages: Math.ceil(total / limit) });
}

export async function createEvent(req: Request, res: Response): Promise<void> {
  const { title, courseCode, type, description, deadline } = req.body as {
    title?: string;
    courseCode?: string;
    type?: EventType;
    description?: string;
    deadline?: string;
  };

  if (!title || !courseCode || !deadline) {
    res.status(400).json({ error: 'title, courseCode, and deadline are required' });
    return;
  }

  const slug = await uniqueSlug(courseCode, title);

  const event = await prisma.submissionEvent.create({
    data: {
      slug,
      title,
      courseCode,
      type: type ?? 'assignment',
      description,
      deadline: new Date(deadline),
      createdBy: req.user!.id,
    },
  });

  res.status(201).json(event);
}

export async function getEventBySlug(req: Request, res: Response): Promise<void> {
  const slug = req.params.slug as string;
  const cacheKey = `event:slug:${slug}`;

  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const event = await prisma.submissionEvent.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, title: true, courseCode: true,
      type: true, description: true, deadline: true,
      isClosed: true, isDeleted: true,
    },
  });

  if (!event || event.isDeleted) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  cacheSet(cacheKey, event, 10_000);
  res.json(event);
}

export async function getEventById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  // Any authenticated user can view any event's detail
  const event = await prisma.submissionEvent.findFirst({
    where: { id, isDeleted: false },
    include: { _count: { select: { submissions: true } } },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const confirmedCount = await prisma.submission.count({
    where: { eventId: id, isConfirmed: true },
  });

  res.json({
    ...event,
    totalSubmissions: event._count.submissions,
    confirmedCount,
    pendingCount: event._count.submissions - confirmedCount,
  });
}

export async function toggleClose(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  // Only the creator can close/reopen their own event
  const event = await prisma.submissionEvent.findFirst({
    where: { id, createdBy: req.user!.id, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found or not authorised' });
    return;
  }

  const updated = await prisma.submissionEvent.update({
    where: { id },
    data: { isClosed: !event.isClosed },
  });

  cacheDelete(`event:slug:${event.slug}`);
  res.json(updated);
}

export async function deleteEvent(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  // Only the creator can delete their own event
  const event = await prisma.submissionEvent.findFirst({
    where: { id, createdBy: req.user!.id, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found or not authorised' });
    return;
  }

  await prisma.submissionEvent.update({ where: { id }, data: { isDeleted: true } });
  cacheDelete(`event:slug:${event.slug}`);
  res.json({ message: 'Event deleted' });
}
