-- People (and events) an account has scanned by QR (Jamal, 2026-10-28) — My
-- Favourites: an event QR scan is remembered as person_kind 'event' (My Scans
-- only, never a Contact). "My Scans" = every row, newest scan first; "Contacts" = the
-- rows saved with Save to Favourites (is_favourite = 1). One row per scanned
-- person; scanning again refreshes it. The details are a SNAPSHOT of what the
-- scan showed (minimal contact details), so the list needs no joins and keeps
-- working when an event is later removed.
-- Applied by src/database/tools/apply-client-qr-contacts.js.

CREATE TABLE IF NOT EXISTS `client_qr_contacts` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `owner_client_id` int unsigned NOT NULL COMMENT 'Who scanned (website_clients.id)',
  `person_kind` enum('client','contact_person','event') COLLATE utf8mb4_unicode_ci NOT NULL,
  `person_id` int unsigned NOT NULL COMMENT 'website_clients.id, contact_person_logins.id or events.id',
  `event_id` int unsigned DEFAULT NULL COMMENT 'The event both share, at the last scan',
  `role` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'participant / host / contact_person',
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `photo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dial_code` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `relation` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `is_favourite` tinyint(1) NOT NULL DEFAULT '0',
  `favourited_at` datetime DEFAULT NULL,
  `scan_count` int unsigned NOT NULL DEFAULT '1',
  `last_scanned_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_qr_contacts_person` (`owner_client_id`,`person_kind`,`person_id`),
  KEY `idx_client_qr_contacts_fav` (`owner_client_id`,`is_favourite`,`favourited_at`),
  KEY `idx_client_qr_contacts_scans` (`owner_client_id`,`last_scanned_at`),
  KEY `fk_client_qr_contacts_event` (`event_id`),
  CONSTRAINT `fk_client_qr_contacts_owner` FOREIGN KEY (`owner_client_id`) REFERENCES `website_clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_client_qr_contacts_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='My Favourites: people scanned by QR, and the ones saved';
