-- Catch up objects that were added outside the original Prisma migration chain.
DO $$
BEGIN
  CREATE TYPE "UserRole" AS ENUM ('cr', 'acr', 'fin_sec', 'dev');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'confirmed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TransactionType" AS ENUM ('credit', 'debit');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'cr';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasLoggedInBefore" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pushSubscription" TEXT;

CREATE TABLE IF NOT EXISTS "PaymentEvent" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "amount" DECIMAL(10,2) NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "deadline" TIMESTAMP(3) NOT NULL,
  "hasTickets" BOOLEAN NOT NULL DEFAULT false,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentReceipt" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "matricNumber" TEXT NOT NULL,
  "level" TEXT,
  "receiptUrl" TEXT NOT NULL,
  "receiptPublicId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
  "confirmedAt" TIMESTAMP(3),
  "confirmedBy" TEXT,
  "note" TEXT,
  "ticketQrCode" TEXT,
  "isClaimed" BOOLEAN NOT NULL DEFAULT false,
  "claimedAt" TIMESTAMP(3),
  "claimedBy" TEXT,
  CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Transaction" (
  "id" TEXT NOT NULL,
  "type" "TransactionType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "proofUrl" TEXT,
  "proofPublicId" TEXT,
  "recordedBy" TEXT NOT NULL,
  "receiptId" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_slug_key" ON "PaymentEvent"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReceipt_matricNumber_eventId_key" ON "PaymentReceipt"("matricNumber", "eventId");
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_receiptId_key" ON "Transaction"("receiptId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentEvent_createdBy_fkey') THEN
    ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_createdBy_fkey"
      FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentReceipt_eventId_fkey') THEN
    ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "PaymentEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_recordedBy_fkey') THEN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recordedBy_fkey"
      FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_receiptId_fkey') THEN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_receiptId_fkey"
      FOREIGN KEY ("receiptId") REFERENCES "PaymentReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Speed up event-scoped dashboard searches and status counters.
CREATE INDEX IF NOT EXISTS "Submission_eventId_fullName_idx" ON "Submission"("eventId", "fullName");
CREATE INDEX IF NOT EXISTS "Submission_eventId_matricNumber_idx" ON "Submission"("eventId", "matricNumber");
CREATE INDEX IF NOT EXISTS "Submission_eventId_isConfirmed_idx" ON "Submission"("eventId", "isConfirmed");

CREATE INDEX IF NOT EXISTS "PaymentReceipt_eventId_fullName_idx" ON "PaymentReceipt"("eventId", "fullName");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_eventId_matricNumber_idx" ON "PaymentReceipt"("eventId", "matricNumber");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_eventId_status_idx" ON "PaymentReceipt"("eventId", "status");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_eventId_isClaimed_idx" ON "PaymentReceipt"("eventId", "isClaimed");
CREATE INDEX IF NOT EXISTS "Transaction_occurredAt_idx" ON "Transaction"("occurredAt");
CREATE INDEX IF NOT EXISTS "Transaction_isDeleted_idx" ON "Transaction"("isDeleted");
