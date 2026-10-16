-- Wed Wishes Phase 2 (2026-10-16): content filter + stronger block.
--
-- event_wishes.is_flagged      the content filter caught a blocked word in it
--                              (the word is already replaced); cleared when the
--                              organizer reviews it (Show / Mark Reviewed)
-- event_wish_blocks.hide_menu  the blocked participant does not even see the
--                              Wed Wishes menu on that event
--
-- The filter's words and switches live in events.wish_settings (JSON, `filter`).
-- Re-runnable: each column is added only when missing.

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_wishes' AND COLUMN_NAME = 'is_flagged');
SET @sql := IF(@has = 0,
  'ALTER TABLE `event_wishes` ADD COLUMN `is_flagged` tinyint(1) NOT NULL DEFAULT ''0'' COMMENT ''1 = the content filter caught a blocked word, not reviewed yet'' AFTER `is_hidden`',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_wish_blocks' AND COLUMN_NAME = 'hide_menu');
SET @sql := IF(@has = 0,
  'ALTER TABLE `event_wish_blocks` ADD COLUMN `hide_menu` tinyint(1) NOT NULL DEFAULT ''1'' COMMENT ''1 = the Wed Wishes menu is hidden from this participant'' AFTER `author_client_id`',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check.
SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'event_wishes' AND COLUMN_NAME = 'is_flagged')
    OR (TABLE_NAME = 'event_wish_blocks' AND COLUMN_NAME = 'hide_menu'));
