import { submissionService } from '../modules/submissions/application/submissionService';
import { created, file, ok } from '../shared/http/controller';
import { routeParam } from '../shared/http/param';

const excelContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const createSubmission = created((req) => submissionService.create(req.body));

export const getSubmissions = ok((req) =>
  submissionService.list(routeParam(req.params.eventId), req.query as Record<string, string>)
);

export const confirmSubmission = ok((req) =>
  submissionService.confirm(routeParam(req.params.id), req.user)
);

export const scanConfirm = ok((req) =>
  submissionService.scanConfirm(req.body.submissionId, req.user)
);

export const confirmAllSubmissions = ok((req) =>
  submissionService.confirmAll(routeParam(req.params.eventId), req.user)
);

export const getSubmissionStatus = ok((req) =>
  submissionService.status(routeParam(req.params.id))
);

export const exportToExcel = file(async (req) => ({
  ...(await submissionService.export(routeParam(req.params.eventId))),
  contentType: excelContentType,
}));
