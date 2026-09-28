CREATE TABLE "StudentAccount" (
    "id" TEXT NOT NULL,
    "matricNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentAccount_matricNumber_key" ON "StudentAccount"("matricNumber");
CREATE UNIQUE INDEX "StudentAccount_email_key" ON "StudentAccount"("email");

CREATE TABLE "StudentRoster" (
    "id" TEXT NOT NULL,
    "matricNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentRoster_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentRoster_matricNumber_key" ON "StudentRoster"("matricNumber");

INSERT INTO "StudentRoster" ("id", "matricNumber", "fullName", "createdAt", "updatedAt")
SELECT 'roster-' || md5(records."matricNumber"), records."matricNumber", records."fullName", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (combined."matricNumber") combined."matricNumber", combined."fullName"
    FROM (
        SELECT UPPER(TRIM("matricNumber")) AS "matricNumber", TRIM("fullName") AS "fullName", "submittedAt"
        FROM "Submission"
        UNION ALL
        SELECT UPPER(TRIM("matricNumber")) AS "matricNumber", TRIM("fullName") AS "fullName", "submittedAt"
        FROM "PaymentReceipt"
    ) combined
    WHERE combined."matricNumber" <> '' AND combined."fullName" <> ''
    ORDER BY combined."matricNumber", combined."submittedAt" DESC
) records;

CREATE TABLE "StudentRegistrationOtp" (
    "id" TEXT NOT NULL,
    "matricNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentRegistrationOtp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentRegistrationOtp_matricNumber_key" ON "StudentRegistrationOtp"("matricNumber");
CREATE INDEX "StudentRegistrationOtp_expiresAt_idx" ON "StudentRegistrationOtp"("expiresAt");
