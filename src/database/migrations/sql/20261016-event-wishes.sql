-- Event Wishes (2026-10-16) — the app's Wishes menu, replacing its sample list.
--
-- event_wishes        one wish: written by a participant in the app, or added
--                     by the organizer on someone's behalf (author_client_id NULL).
-- event_wish_blocks   participants blocked from sending wishes on ONE event
--                     (Wishes only — they still see the event and everything else).
--
-- Re-runnable (IF NOT EXISTS). Apply on local, then production.

CREATE TABLE IF NOT EXISTS `event_wishes` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `event_id` int unsigned NOT NULL,
  `website_client_id` int unsigned NOT NULL COMMENT 'the event owner',
  `company_id` int unsigned DEFAULT NULL,
  `author_client_id` int unsigned DEFAULT NULL COMMENT 'participant who wrote it, NULL = added by the organizer',
  `guest_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `photo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_hidden` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = hidden from participants, kept for the organizer',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wish_event` (`event_id`,`created_at`),
  KEY `idx_wish_author` (`author_client_id`),
  CONSTRAINT `fk_event_wish_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_wish_blocks` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `event_id` int unsigned NOT NULL,
  `author_client_id` int unsigned NOT NULL COMMENT 'the blocked participant',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wish_block` (`event_id`,`author_client_id`),
  CONSTRAINT `fk_event_wish_block_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The menu is called "Wed Wishes" (Jamal, 2026-10-16). The app and the portal
-- read the name from this row.
UPDATE `event_menus` SET `name` = 'Wed Wishes' WHERE `slug` = 'wishes';

-- Check: both tables exist, and the menu name.
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('event_wishes', 'event_wish_blocks');
SELECT `id`, `name`, `slug` FROM `event_menus` WHERE `slug` = 'wishes';
