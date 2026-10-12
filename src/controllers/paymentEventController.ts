import { paymentEventService } from '../modules/paymentEvents/application/paymentEventService';
import { created, ok } from '../shared/http/controller';
import { routeParam } from '../shared/http/param';

export const listPaymentEvents = ok((req) =>
  paymentEventService.list({
    page: req.query.page as string | undefined,
    limit: req.query.limit as string | undefined,
  })
);

export const createPaymentEvent = created((req) =>
  paymentEventService.create({ ...req.body, userId: req.user!.id })
);

export const getPaymentEventBySlug = ok((req) =>
  paymentEventService.getPublicBySlug(routeParam(req.params.slug))
);

export const getPaymentEventById = ok((req) =>
  paymentEventService.getById(routeParam(req.params.id))
);

export const updatePaymentEvent = ok((req) =>
  paymentEventService.update(routeParam(req.params.id), req.body)
);

export const toggleClosePaymentEvent = ok((req) =>
  paymentEventService.toggleClose(routeParam(req.params.id))
);

export const extendPaymentEvent = ok((req) =>
  paymentEventService.extend(routeParam(req.params.id), req.body.deadline)
);

export const deletePaymentEvent = ok((req) =>
  paymentEventService.delete(routeParam(req.params.id))
);
