CREATE TYPE "AnnouncementStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "AnnouncementCategory" AS ENUM ('general', 'academic', 'practical', 'finance', 'event', 'opportunity', 'emergency');
CREATE TYPE "AnnouncementPriority" AS ENUM ('normal', 'important', 'urgent');
CREATE TYPE "AnnouncementSourceType" AS ENUM ('official_class', 'educational_contribution', 'lecturer_information', 'external_information');

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "rawSource" TEXT,
    "category" "AnnouncementCategory" NOT NULL DEFAULT 'general',
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'normal',
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'draft',
    "sourceType" "AnnouncementSourceType" NOT NULL DEFAULT 'official_class',
    "contributorName" TEXT,
    "contributorCredit" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "paymentEventId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementRevision" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "changeNote" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lastReadVersion" INTEGER NOT NULL,
    "firstReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedVersion" INTEGER,
    "acknowledgedAt" TIMESTAMP(3),
    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Announcement_slug_key" ON "Announcement"("slug");
CREATE INDEX "Announcement_status_isPinned_publishedAt_idx" ON "Announcement"("status", "isPinned", "publishedAt");
CREATE INDEX "Announcement_status_category_publishedAt_idx" ON "Announcement"("status", "category", "publishedAt");
CREATE INDEX "Announcement_createdBy_status_updatedAt_idx" ON "Announcement"("createdBy", "status", "updatedAt");
CREATE INDEX "Announcement_paymentEventId_idx" ON "Announcement"("paymentEventId");
CREATE UNIQUE INDEX "AnnouncementRevision_announcementId_version_key" ON "AnnouncementRevision"("announcementId", "version");
CREATE INDEX "AnnouncementRevision_announcementId_createdAt_idx" ON "AnnouncementRevision"("announcementId", "createdAt");
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_studentId_key" ON "AnnouncementRead"("announcementId", "studentId");
CREATE INDEX "AnnouncementRead_studentId_lastReadAt_idx" ON "AnnouncementRead"("studentId", "lastReadAt");

ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_paymentEventId_fkey" FOREIGN KEY ("paymentEventId") REFERENCES "PaymentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRevision" ADD CONSTRAINT "AnnouncementRevision_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRevision" ADD CONSTRAINT "AnnouncementRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
