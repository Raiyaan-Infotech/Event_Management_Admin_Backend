-- Events are PUBLIC by default (Jamal, 2026-10-28), and every existing event
-- becomes public. Applied by src/database/tools/apply-events-public.js.

ALTER TABLE `events`
  MODIFY COLUMN `privacy` enum('private','public','unlisted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'public';

UPDATE `events` SET `privacy` = 'public' WHERE `privacy` <> 'public';
