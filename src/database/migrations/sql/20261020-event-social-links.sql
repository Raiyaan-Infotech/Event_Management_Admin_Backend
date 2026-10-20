-- Social Links (2026-10-20) — the app's Social Links menu.
--
-- event_social_links  one link of ONE event. Four PRESET rows (Instagram,
--                     Facebook, X, YouTube — `platform_key` set) exist for
--                     every event, made the first time the list is read; their
--                     platform and icon are fixed, they cannot be deleted
--                     (Remove only clears the link). Every other row is a
--                     CUSTOM link (`platform_key` NULL): the organizer types
--                     the platform name and uploads its icon (stored 256×256 PNG).
--                     A row with no URL is never shown to participants.
--
-- The "Social Links" menu row itself is added by
-- src/database/tools/apply-event-social-links.js (it also grants it to every plan).
--
-- Re-runnable (IF NOT EXISTS). Apply on local, then production — BEFORE pushing
-- the backend that has the EventSocialLink model.

CREATE TABLE IF NOT EXISTS `event_social_links` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `event_id` int unsigned NOT NULL,
  `website_client_id` int unsigned NOT NULL COMMENT 'the event owner',
  `platform_key` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'instagram / facebook / x / youtube = preset; NULL = custom',
  `platform_name` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'NULL = not added yet (presets only)',
  `description` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `icon_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'custom links only',
  `sort_order` int NOT NULL DEFAULT '0',
  `open_external` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1 = open in the platform''s own app',
  `show_in_app` tinyint(1) NOT NULL DEFAULT '1',
  `company_id` int unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_social_link_preset` (`event_id`,`platform_key`),
  KEY `idx_social_link_event` (`event_id`,`sort_order`),
  CONSTRAINT `fk_social_link_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Check: the table exists.
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_social_links';
