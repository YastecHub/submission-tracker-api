import type { AnnouncementPriority, Prisma } from '@prisma/client';

export interface AnnouncementNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  priority: AnnouncementPriority;
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function announcementNotificationPayload(announcement: {
  id: string;
  slug: string;
  title: string;
  summary: string;
  priority: AnnouncementPriority;
  version: number;
}): AnnouncementNotificationPayload {
  return {
    title: shorten(announcement.title, 180),
    body: shorten(announcement.summary, 240),
    url: `/student/news/${announcement.slug}`,
    tag: `bulletin-${announcement.id}-${announcement.version}`,
    priority: announcement.priority,
  };
}

export function notificationPayloadJson(payload: AnnouncementNotificationPayload): Prisma.InputJsonValue {
  return payload as unknown as Prisma.InputJsonValue;
}
