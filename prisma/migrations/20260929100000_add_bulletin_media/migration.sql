ALTER TABLE "AnnouncementRevision" ADD COLUMN "media" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "AnnouncementMedia" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "altText" TEXT NOT NULL,
    "caption" TEXT,
    "sectionId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnnouncementMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementMedia_publicId_key" ON "AnnouncementMedia"("publicId");
CREATE INDEX "AnnouncementMedia_announcementId_sortOrder_idx" ON "AnnouncementMedia"("announcementId", "sortOrder");
CREATE INDEX "AnnouncementMedia_announcementId_sectionId_sortOrder_idx" ON "AnnouncementMedia"("announcementId", "sectionId", "sortOrder");

ALTER TABLE "AnnouncementMedia" ADD CONSTRAINT "AnnouncementMedia_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementMedia" ADD CONSTRAINT "AnnouncementMedia_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
