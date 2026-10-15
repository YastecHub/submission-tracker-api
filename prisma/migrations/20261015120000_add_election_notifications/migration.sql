-- Push notifications that don't belong to a Bulletin post (election notices) reuse the outbox.
ALTER TABLE "NotificationOutbox" ALTER COLUMN "announcementId" DROP NOT NULL;
ALTER TABLE "NotificationOutbox" ALTER COLUMN "announcementVersion" DROP NOT NULL;

-- One row per election notice sent ("voting is open", "1 hour left", reminders, results).
-- The unique key makes sure each notice goes out once, even with several servers or restarts.
CREATE TABLE "ElectionNotification" (
    "id" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentByName" TEXT,
    "pushQueued" INTEGER NOT NULL DEFAULT 0,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElectionNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ElectionNotification_electionId_key_key" ON "ElectionNotification"("electionId", "key");

ALTER TABLE "ElectionNotification" ADD CONSTRAINT "ElectionNotification_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;
