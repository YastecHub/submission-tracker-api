-- Speed up event-scoped dashboard searches and status counters.
CREATE INDEX "Submission_eventId_fullName_idx" ON "Submission"("eventId", "fullName");
CREATE INDEX "Submission_eventId_matricNumber_idx" ON "Submission"("eventId", "matricNumber");
CREATE INDEX "Submission_eventId_isConfirmed_idx" ON "Submission"("eventId", "isConfirmed");

CREATE INDEX "PaymentReceipt_eventId_fullName_idx" ON "PaymentReceipt"("eventId", "fullName");
CREATE INDEX "PaymentReceipt_eventId_matricNumber_idx" ON "PaymentReceipt"("eventId", "matricNumber");
CREATE INDEX "PaymentReceipt_eventId_status_idx" ON "PaymentReceipt"("eventId", "status");
CREATE INDEX "PaymentReceipt_eventId_isClaimed_idx" ON "PaymentReceipt"("eventId", "isClaimed");
