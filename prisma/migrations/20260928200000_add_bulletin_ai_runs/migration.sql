CREATE TYPE "AnnouncementAiRunStatus" AS ENUM ('completed', 'failed');

CREATE TABLE "AnnouncementAiRun" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceLength" INTEGER NOT NULL,
    "status" "AnnouncementAiRunStatus" NOT NULL,
    "result" JSONB,
    "acceptedFields" JSONB,
    "acceptedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementAiRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnnouncementAiRun_requestedBy_createdAt_idx" ON "AnnouncementAiRun"("requestedBy", "createdAt");
CREATE INDEX "AnnouncementAiRun_announcementId_createdAt_idx" ON "AnnouncementAiRun"("announcementId", "createdAt");

ALTER TABLE "AnnouncementAiRun" ADD CONSTRAINT "AnnouncementAiRun_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnnouncementAiRun" ADD CONSTRAINT "AnnouncementAiRun_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
