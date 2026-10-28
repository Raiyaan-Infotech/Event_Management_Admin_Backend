-- Guests become EVENT-BASED (Jamal, 2026-10-28).
--
-- A guest is added to ONE event and invited to it. Their status is worked out
-- on read (clientGuest.service GUEST_STATUS), nothing else is stored:
--   added     invited_at NULL, not a participant
--   invited   invited < 24h ago, not a participant
--   pending   invited >= 24h ago and not a participant, OR joined and answered Maybe
--   confirmed joined (a participant of that event, matched by guest_id or mobile)
--   declined  joined and answered No
--
-- Applied by src/database/tools/apply-guests-event-based.js (re-runnable).

ALTER TABLE `guests`
  ADD COLUMN `event_id` int unsigned DEFAULT NULL COMMENT 'The event this guest belongs to (2026-10-28)' AFTER `group_id`,
  ADD COLUMN `invited_at` datetime DEFAULT NULL COMMENT 'UTC, when the invitation was sent. NULL = not invited yet' AFTER `source`,
  ADD KEY `idx_guests_event` (`event_id`,`deleted_at`),
  ADD CONSTRAINT `fk_guests_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
