-- Student "forgot password": one emailed code per account, and a timestamp that
-- invalidates sessions issued before the password changed.

-- AlterTable
ALTER TABLE "StudentAccount" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StudentPasswordResetOtp" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPasswordResetOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentPasswordResetOtp_studentId_key" ON "StudentPasswordResetOtp"("studentId");

-- CreateIndex
CREATE INDEX "StudentPasswordResetOtp_expiresAt_idx" ON "StudentPasswordResetOtp"("expiresAt");

-- AddForeignKey
ALTER TABLE "StudentPasswordResetOtp" ADD CONSTRAINT "StudentPasswordResetOtp_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
