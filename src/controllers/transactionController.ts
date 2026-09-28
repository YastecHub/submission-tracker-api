import { transactionService } from '../modules/transactions/application/transactionService';
import { created, ok } from '../shared/http/controller';
import { routeParam } from '../shared/http/param';

export const getLedger = ok((req) =>
  transactionService.ledger(req.query as Record<string, string>)
);

export const verifyMatric = ok((req) =>
  transactionService.verifyMatric(req.student!.matricNumber)
);

export const listTransactionsAdmin = ok((req) =>
  transactionService.adminList(req.query as Record<string, string>)
);

export const createTransaction = created((req) =>
  transactionService.create(req.body, req.file, req.user!.id)
);

export const updateTransaction = ok((req) =>
  transactionService.update(routeParam(req.params.id), req.body, req.file)
);

export const deleteTransaction = ok((req) =>
  transactionService.delete(routeParam(req.params.id))
);
