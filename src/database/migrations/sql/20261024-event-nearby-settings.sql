-- Near By (2026-10-24) — the organizer's Near By Settings (app Quick Action).
--
--   events.nearby_settings  JSON { categories: [...], radius_km, sort }
--                           NULL = never saved (the page suggests a set).
--   event_nearby_cache      the last Google Places result for those settings
--                           and the venue pin, ONE row per event — so guests
--                           opening Near By do not each cost a Google call.
--                           Its own table (not a column on events) so the
--                           ~30 KB list is never read with ordinary event reads.
--
-- Re-runnable: the column is added only when missing; the table IF NOT EXISTS.
-- Apply on local, then production — BEFORE pushing the backend.

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'nearby_settings');
SET @sql := IF(@has = 0,
  'ALTER TABLE `events` ADD COLUMN `nearby_settings` json DEFAULT NULL COMMENT ''Near By: categories, radius_km, sort; NULL = not set up'' AFTER `wish_settings`',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `event_nearby_cache` (
  `event_id` int unsigned NOT NULL,
  `cache_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'venue pin + radius + categories the places were fetched for',
  `places` json NOT NULL,
  `fetched_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  CONSTRAINT `fk_nearby_cache_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Check: the column and the table exist.
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'nearby_settings';
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_nearby_cache';
