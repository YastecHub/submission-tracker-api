CREATE TYPE "AmountCheckStatus" AS ENUM ('pending', 'matched', 'mismatch', 'unreadable', 'unavailable');

ALTER TABLE "PaymentReceipt"
  ADD COLUMN "extractedAmount" DECIMAL(10, 2),
  ADD COLUMN "amountCheckStatus" "AmountCheckStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "amountCheckConfidence" DOUBLE PRECISION,
  ADD COLUMN "amountCheckNote" TEXT,
  ADD COLUMN "amountCheckedAt" TIMESTAMP(3),
  DROP COLUMN "amountPaid";

CREATE INDEX "PaymentReceipt_eventId_amountCheckStatus_idx" ON "PaymentReceipt"("eventId", "amountCheckStatus");
