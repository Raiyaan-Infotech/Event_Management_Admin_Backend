-- Wed Wishes as posts (2026-10-16, Jamal's second mockup): a wish is a Text,
-- Image or Video post, addressed To Groom / To Bride / To Both, with likes.
-- No comments, no share, no reports (Jamal).
--
-- event_wishes      + post_type, audience, video_url, thumbnail_url,
--                     duration_seconds, size_bytes (the media's stored bytes,
--                     counted in the plan's storage like gallery files)
-- event_wish_likes  one row per person who liked a wish
--
-- Re-runnable: the columns are added only when `post_type` is missing.

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_wishes' AND COLUMN_NAME = 'post_type');
SET @sql := IF(@has = 0,
  'ALTER TABLE `event_wishes`
     ADD COLUMN `post_type` enum(''text'',''image'',''video'') NOT NULL DEFAULT ''text'' AFTER `author_client_id`,
     ADD COLUMN `audience` enum(''groom'',''bride'',''both'') NOT NULL DEFAULT ''both'' AFTER `post_type`,
     ADD COLUMN `video_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `photo`,
     ADD COLUMN `thumbnail_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `video_url`,
     ADD COLUMN `duration_seconds` smallint unsigned DEFAULT NULL AFTER `thumbnail_url`,
     ADD COLUMN `size_bytes` bigint unsigned NOT NULL DEFAULT ''0'' AFTER `duration_seconds`',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Old wishes with a photo are image posts.
UPDATE `event_wishes` SET `post_type` = 'image' WHERE `photo` IS NOT NULL AND `post_type` = 'text';

CREATE TABLE IF NOT EXISTS `event_wish_likes` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `wish_id` int unsigned NOT NULL,
  `client_id` int unsigned NOT NULL COMMENT 'who liked it (participant or organizer)',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wish_like` (`wish_id`,`client_id`),
  CONSTRAINT `fk_event_wish_like_wish` FOREIGN KEY (`wish_id`) REFERENCES `event_wishes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Check.
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_wishes'
  AND COLUMN_NAME IN ('post_type', 'audience', 'video_url', 'thumbnail_url', 'duration_seconds', 'size_bytes');
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_wish_likes';
