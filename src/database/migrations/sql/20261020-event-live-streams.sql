-- Live Streaming (2026-10-20) — the app's Live Streaming menu.
--
-- event_live_stream_types  the organizer's own Stream Types for ONE event
--                          ("Wedding Ceremony", "Reception"), like Gallery
--                          categories. Every event has one built-in type,
--                          "Live Stream" (is_default = 1), made the first time
--                          it is needed; it cannot be renamed or deleted, and a
--                          deleted type's streams move to it.
-- event_live_streams       one stream: a link to YouTube / Facebook / … with a
--                          date, time, cover and an Enabled switch. Participants
--                          see enabled streams only and watch by opening the link.
--
-- The "Live Streaming" menu row itself is added by
-- src/database/tools/apply-event-live-streams.js (it also grants it to every plan).
--
-- Re-runnable (IF NOT EXISTS). Apply on local, then production — BEFORE pushing
-- the backend that has the EventLiveStream models.

CREATE TABLE IF NOT EXISTS `event_live_stream_types` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `event_id` int unsigned NOT NULL,
  `website_client_id` int unsigned NOT NULL COMMENT 'the event owner',
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_image` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'NULL = the first stream''s cover',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_default` tinyint(1) DEFAULT NULL COMMENT '1 = the built-in Live Stream type; NULL for every other',
  `company_id` int unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_live_type_event` (`event_id`,`sort_order`),
  UNIQUE KEY `uq_live_type_default` (`event_id`,`is_default`),
  CONSTRAINT `fk_live_type_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_live_streams` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `event_id` int unsigned NOT NULL,
  `website_client_id` int unsigned NOT NULL COMMENT 'the event owner',
  `type_id` int unsigned DEFAULT NULL,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `platform` enum('youtube','facebook','instagram','zoom','google_meet','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'youtube',
  `stream_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stream_date` date NOT NULL,
  `stream_time` time NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_image` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '0 = hidden from participants (Disable)',
  `sort_order` int NOT NULL DEFAULT '0',
  `company_id` int unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_live_stream_event` (`event_id`,`type_id`,`sort_order`),
  CONSTRAINT `fk_live_stream_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_live_stream_type` FOREIGN KEY (`type_id`) REFERENCES `event_live_stream_types` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Check: both tables exist.
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('event_live_stream_types', 'event_live_streams');
