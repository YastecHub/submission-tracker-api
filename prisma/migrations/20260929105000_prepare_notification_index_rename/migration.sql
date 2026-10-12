-- Repair for fresh databases (see 20261012000000_repair_notification_outbox_index).
--
-- 20260929110542_updated_the_roles renames the NotificationOutbox unique index,
-- but that index is only created later by 20260929140000_add_bulletin_notifications.
-- On a brand-new database the rename therefore failed. This placeholder index gives
-- the rename something to act on; the repair migration drops it again.
--
-- On databases where those migrations already ran (production), the placeholder
-- name is free because the real index was already renamed, so this is harmless.
-- Applied migrations are intentionally left untouched so their checksums still match.
CREATE TABLE IF NOT EXISTS "_migration_index_placeholder" ("id" INTEGER);
CREATE INDEX IF NOT EXISTS "NotificationOutbox_subscriptionId_announcementId_announcementVe"
  ON "_migration_index_placeholder" ("id");
