import { announcementService } from '../modules/announcements/application/announcementService';
import { announcementAiService } from '../modules/announcements/application/announcementAiService';
import { announcementMediaService } from '../modules/announcements/application/announcementMediaService';
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

export const organizeAnnouncement = ok((req) =>
  announcementAiService.organize(req.body, req.user!)
);

export const uploadAnnouncementMedia = created((req) =>
  announcementMediaService.upload(
    routeParam(req.params.id),
    req.body,
    Array.isArray(req.files) ? req.files : [],
    req.user!,
  )
);

export const updateAnnouncementMedia = ok((req) =>
  announcementMediaService.update(routeParam(req.params.id), req.body, req.user!)
);

export const deleteAnnouncementMedia = ok((req) =>
  announcementMediaService.remove(
    routeParam(req.params.id),
    routeParam(req.params.mediaId),
    req.body,
    req.user!,
  )
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
