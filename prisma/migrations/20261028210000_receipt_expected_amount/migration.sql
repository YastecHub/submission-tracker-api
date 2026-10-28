-- The price a receipt was submitted against. A payment's price can now change while people
-- are paying; each receipt keeps the price at the time, and the ledger credits that amount.
ALTER TABLE "PaymentReceipt" ADD COLUMN "expectedAmount" DECIMAL(10,2);

UPDATE "PaymentReceipt" AS receipt
SET "expectedAmount" = event."amount"
FROM "PaymentEvent" AS event
WHERE event."id" = receipt."eventId";

ALTER TABLE "PaymentReceipt" ALTER COLUMN "expectedAmount" SET NOT NULL;
