-- Finish the repair started in 20260929105000_prepare_notification_index_rename.
-- Drops the placeholder (and the placeholder index the old rename migration acted on),
-- then gives the real NotificationOutbox unique index the name Prisma expects.
-- Safe on every database: each step only runs when it still has something to do.
DROP TABLE IF EXISTS "_migration_index_placeholder";

DO $$
BEGIN
  IF to_regclass('"NotificationOutbox_subscriptionId_announcementId_announcementVe"') IS NOT NULL THEN
    ALTER INDEX "NotificationOutbox_subscriptionId_announcementId_announcementVe"
      RENAME TO "NotificationOutbox_subscriptionId_announcementId_announceme_key";
  END IF;
END $$;
