CREATE TYPE "NotificationOutboxStatus" AS ENUM ('pending', 'processing', 'delivered', 'dead');

CREATE TABLE "StudentPushSubscription" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "expirationTime" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "announcementId" TEXT NOT NULL,
    "announcementVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentPushSubscription_endpoint_key" ON "StudentPushSubscription"("endpoint");
CREATE INDEX "StudentPushSubscription_studentId_updatedAt_idx" ON "StudentPushSubscription"("studentId", "updatedAt");
CREATE UNIQUE INDEX "NotificationOutbox_subscriptionId_announcementId_announcementVersion_key" ON "NotificationOutbox"("subscriptionId", "announcementId", "announcementVersion");
CREATE INDEX "NotificationOutbox_status_availableAt_createdAt_idx" ON "NotificationOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "NotificationOutbox_announcementId_announcementVersion_idx" ON "NotificationOutbox"("announcementId", "announcementVersion");

ALTER TABLE "StudentPushSubscription" ADD CONSTRAINT "StudentPushSubscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "StudentPushSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
