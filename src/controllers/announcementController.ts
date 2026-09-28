import { announcementService } from '../modules/announcements/application/announcementService';
import { created, ok } from '../shared/http/controller';
import { routeParam } from '../shared/http/param';

export const listAnnouncementsAdmin = ok((req) =>
  announcementService.listAdmin(req.query as Record<string, unknown>)
);

export const getAnnouncementAdmin = ok((req) =>
  announcementService.getAdmin(routeParam(req.params.id))
);

export const createAnnouncement = created((req) =>
  announcementService.create(req.body, req.user!)
);

export const updateAnnouncement = ok((req) =>
  announcementService.update(routeParam(req.params.id), req.body, req.user!)
);

export const publishAnnouncement = ok((req) =>
  announcementService.publish(routeParam(req.params.id), req.body, req.user!)
);

export const archiveAnnouncement = ok((req) =>
  announcementService.archive(routeParam(req.params.id), req.body, req.user!)
);

export const listAnnouncementPaymentOptions = ok(() =>
  announcementService.paymentOptions()
);

export const listPublishedAnnouncements = ok((req) =>
  announcementService.listFeed(req.query as Record<string, unknown>, req.student!.id)
);

export const getPublishedAnnouncement = ok((req) =>
  announcementService.getPublished(routeParam(req.params.slug), req.student!.id)
);

export const getAnnouncementUnreadCount = ok((req) =>
  announcementService.unreadCount(req.student!.id)
);

export const markAnnouncementRead = ok((req) =>
  announcementService.markRead(routeParam(req.params.id), req.student!.id)
);
