-- Wed Wishes settings (2026-10-16) — the settings icon on the Wishes list,
-- like Family's: events.wish_settings JSON, NULL = the defaults (all on).
-- Re-runnable: the column is added only when it is missing.

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'wish_settings');
SET @sql := IF(@has = 0,
  'ALTER TABLE `events` ADD COLUMN `wish_settings` json DEFAULT NULL COMMENT ''The organizer Wed Wishes settings, NULL = the defaults'' AFTER `family_settings`',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check: the column exists.
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'wish_settings';
