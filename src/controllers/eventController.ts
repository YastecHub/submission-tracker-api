import { submissionEventService } from '../modules/submissionEvents/application/submissionEventService';
import { created, ok } from '../shared/http/controller';
import { routeParam } from '../shared/http/param';

export const listEvents = ok((req) =>
  submissionEventService.list({
    page: req.query.page as string | undefined,
    limit: req.query.limit as string | undefined,
  })
);

export const createEvent = created((req) =>
  submissionEventService.create({ ...req.body, userId: req.user!.id })
);

export const getEventBySlug = ok((req) =>
  submissionEventService.getPublicBySlug(routeParam(req.params.slug))
);

export const getEventById = ok((req) =>
  submissionEventService.getById(routeParam(req.params.id), req.user)
);

export const toggleClose = ok((req) =>
  submissionEventService.toggleClose(routeParam(req.params.id), req.user)
);

export const extendEvent = ok((req) =>
  submissionEventService.extend(routeParam(req.params.id), req.body.deadline, req.user)
);

export const deleteEvent = ok((req) =>
  submissionEventService.delete(routeParam(req.params.id), req.user)
);
