-- My Favourites per EVENT and per OWNER (Jamal, 2026-10-28):
--   * a contact saved in one event shows only in that event's My Favourites;
--   * a CONTACT PERSON (no account) has a list of their own, which the event's
--     client never sees.
-- `owner_key` = 'c:<website_clients.id>' or 'cp:<contact_person_logins.id>';
-- one row per (owner, scanned person/event, event).
-- Applied step by step by src/database/tools/apply-qr-contacts-per-event.js.

ALTER TABLE `client_qr_contacts`
  ADD COLUMN `owner_key` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'c:<client id> or cp:<contact person id>' AFTER `id`,
  ADD COLUMN `owner_contact_person_id` int unsigned DEFAULT NULL COMMENT 'contact_person_logins.id when a contact person scanned' AFTER `owner_client_id`,
  MODIFY COLUMN `owner_client_id` int unsigned DEFAULT NULL COMMENT 'Who scanned (website_clients.id), NULL for a contact person';

UPDATE `client_qr_contacts` SET `owner_key` = CONCAT('c:', `owner_client_id`) WHERE `owner_key` IS NULL;

ALTER TABLE `client_qr_contacts`
  MODIFY COLUMN `owner_key` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'c:<client id> or cp:<contact person id>',
  DROP INDEX `uq_client_qr_contacts_person`,
  ADD UNIQUE KEY `uq_client_qr_contacts_owner_event` (`owner_key`,`person_kind`,`person_id`,`event_id`),
  ADD KEY `idx_client_qr_contacts_owner_event` (`owner_key`,`event_id`,`last_scanned_at`),
  ADD CONSTRAINT `fk_client_qr_contacts_owner_cp` FOREIGN KEY (`owner_contact_person_id`) REFERENCES `contact_person_logins` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
