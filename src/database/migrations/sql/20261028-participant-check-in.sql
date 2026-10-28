-- Mark Attendance (Jamal, 2026-10-28): a private event's organizer or contact
-- person scans a participant's QR and marks them present. One check-in per
-- participant row. Verify Participant writes nothing.
-- Applied by src/database/tools/apply-participant-check-in.js.

ALTER TABLE `event_participants`
  ADD COLUMN `checked_in_at` datetime DEFAULT NULL COMMENT 'UTC, Mark Attendance (private events)',
  ADD COLUMN `checked_in_by_client_id` int unsigned DEFAULT NULL COMMENT 'Who marked it (0/NULL = a contact person)',
  ADD COLUMN `checked_in_by_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD KEY `idx_event_participants_check_in` (`event_id`,`checked_in_at`);
