import { Request, Response } from 'express';
import { PrismaClient, EventType, Prisma } from '@prisma/client';
import { uniqueSlug } from '../utils/slugGenerator';
import { cacheGet, cacheSet, cacheDelete } from '../utils/cache';

const prisma = new PrismaClient();

type EventWithCount = Prisma.SubmissionEventGetPayload<{
  include: { _count: { select: { submissions: true } } };
}>;

export async function listEvents(req: Request, res: Response): Promise<void> {
  const [events, confirmedGroups] = await Promise.all([
    prisma.submissionEvent.findMany({
      where: { createdBy: req.user!.id, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { submissions: true } } },
    }),
    prisma.submission.groupBy({
      by: ['eventId'],
      where: { event: { createdBy: req.user!.id }, isConfirmed: true },
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

  res.json(eventsWithStats);
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

  // Serve from cache — 300 students hitting same link won't all hit the DB
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

  // Cache for 10 seconds — safe because isClosed is busted on toggleClose
  cacheSet(cacheKey, event, 10_000);
  res.json(event);
}

export async function getEventById(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const event = await prisma.submissionEvent.findFirst({
    where: { id, createdBy: req.user!.id, isDeleted: false },
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

  const event = await prisma.submissionEvent.findFirst({
    where: { id, createdBy: req.user!.id, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const updated = await prisma.submissionEvent.update({
    where: { id },
    data: { isClosed: !event.isClosed },
  });

  // Bust cache so students immediately see the closed state
  cacheDelete(`event:slug:${event.slug}`);
  res.json(updated);
}

export async function deleteEvent(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const event = await prisma.submissionEvent.findFirst({
    where: { id, createdBy: req.user!.id, isDeleted: false },
  });

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  await prisma.submissionEvent.update({ where: { id }, data: { isDeleted: true } });
  cacheDelete(`event:slug:${event.slug}`);
  res.json({ message: 'Event deleted' });
}
