import { paymentReceiptService } from '../modules/paymentReceipts/application/paymentReceiptService';
import { created, file, ok } from '../shared/http/controller';
import { routeParam } from '../shared/http/param';

const excelContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const submitPaymentReceipt = created((req) =>
  paymentReceiptService.submit({ ...req.body, file: req.file })
);

export const getPaymentReceipts = ok((req) =>
  paymentReceiptService.list(routeParam(req.params.eventId), req.query as Record<string, string>, req.user)
);

export const exportPaymentReceiptsToExcel = file(async (req) => ({
  ...(await paymentReceiptService.export(routeParam(req.params.eventId), req.user)),
  contentType: excelContentType,
}));

export const confirmPaymentReceipt = ok((req) =>
  paymentReceiptService.confirm(routeParam(req.params.id), req.body, req.user)
);

export const rejectPaymentReceipt = ok((req) =>
  paymentReceiptService.reject(routeParam(req.params.id), req.body, req.user)
);

export const getPaymentReceiptStatus = ok((req) =>
  paymentReceiptService.status(routeParam(req.params.id))
);

export const getMyTickets = ok((req) =>
  paymentReceiptService.myTickets(req.query.matricNumber as string | undefined)
);

export const claimPaymentReceipt = ok((req) =>
  paymentReceiptService.claim(req.body.code, req.user)
);
