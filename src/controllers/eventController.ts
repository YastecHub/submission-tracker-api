import { Request, Response } from 'express';
import { PrismaClient, EventType, Prisma } from '@prisma/client';
import { uniqueSlug } from '../utils/slugGenerator';

const prisma = new PrismaClient();

type EventWithCount = Prisma.SubmissionEventGetPayload<{
  include: { _count: { select: { submissions: true } } };
}>;

export async function listEvents(req: Request, res: Response): Promise<void> {
  const events = await prisma.submissionEvent.findMany({
    where: { createdBy: req.user!.id, isDeleted: false },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { submissions: true } } },
  });

  const eventsWithStats = await Promise.all(
    events.map(async (event: EventWithCount) => {
      const confirmed = await prisma.submission.count({
        where: { eventId: event.id, isConfirmed: true },
      });
      return {
        ...event,
        totalSubmissions: event._count.submissions,
        confirmedCount: confirmed,
        pendingCount: event._count.submissions - confirmed,
      };
    })
  );

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

  const slug = await uniqueSlug();

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

  const confirmed = await prisma.submission.count({
    where: { eventId: id, isConfirmed: true },
  });

  res.json({
    ...event,
    totalSubmissions: event._count.submissions,
    confirmedCount: confirmed,
    pendingCount: event._count.submissions - confirmed,
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
  res.json({ message: 'Event deleted' });
}
