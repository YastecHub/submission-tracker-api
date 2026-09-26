-- Hot-path indexes for dashboard pagination, scoped counts, exports, and ledger filters.
CREATE INDEX IF NOT EXISTS "SubmissionEvent_isDeleted_createdAt_idx" ON "SubmissionEvent"("isDeleted", "createdAt");
CREATE INDEX IF NOT EXISTS "SubmissionEvent_createdBy_isDeleted_idx" ON "SubmissionEvent"("createdBy", "isDeleted");
CREATE INDEX IF NOT EXISTS "SubmissionEvent_deadline_idx" ON "SubmissionEvent"("deadline");

CREATE INDEX IF NOT EXISTS "Submission_eventId_submittedAt_idx" ON "Submission"("eventId", "submittedAt");
CREATE INDEX IF NOT EXISTS "Submission_eventId_isConfirmed_confirmedAt_idx" ON "Submission"("eventId", "isConfirmed", "confirmedAt");
CREATE INDEX IF NOT EXISTS "Submission_matricNumber_submittedAt_idx" ON "Submission"("matricNumber", "submittedAt");

CREATE INDEX IF NOT EXISTS "PaymentEvent_isDeleted_createdAt_idx" ON "PaymentEvent"("isDeleted", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentEvent_createdBy_isDeleted_idx" ON "PaymentEvent"("createdBy", "isDeleted");
CREATE INDEX IF NOT EXISTS "PaymentEvent_deadline_idx" ON "PaymentEvent"("deadline");

CREATE INDEX IF NOT EXISTS "PaymentReceipt_eventId_submittedAt_idx" ON "PaymentReceipt"("eventId", "submittedAt");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_eventId_status_submittedAt_idx" ON "PaymentReceipt"("eventId", "status", "submittedAt");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_eventId_status_confirmedAt_idx" ON "PaymentReceipt"("eventId", "status", "confirmedAt");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_matricNumber_status_idx" ON "PaymentReceipt"("matricNumber", "status");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_matricNumber_submittedAt_idx" ON "PaymentReceipt"("matricNumber", "submittedAt");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_status_confirmedAt_idx" ON "PaymentReceipt"("status", "confirmedAt");

CREATE INDEX IF NOT EXISTS "Transaction_isDeleted_occurredAt_createdAt_idx" ON "Transaction"("isDeleted", "occurredAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Transaction_isDeleted_type_occurredAt_idx" ON "Transaction"("isDeleted", "type", "occurredAt");
CREATE INDEX IF NOT EXISTS "Transaction_isDeleted_category_occurredAt_idx" ON "Transaction"("isDeleted", "category", "occurredAt");
CREATE INDEX IF NOT EXISTS "Transaction_recordedBy_idx" ON "Transaction"("recordedBy");
