-- Sample blocked words for event #30 "Rahim weds Rahima" (Wed Wishes content
-- filter), so the replaced word + flagged post can be checked in the feed.
-- Data only, no schema change. Re-runnable: a word already in the list is not
-- added again, and the event's other wish_settings are kept.
-- Needs 20261016-event-wish-settings.sql (the wish_settings column).
-- String values use single quotes (production MySQL reads double quotes as names).

-- 1) make sure the filter object exists, and switch it on
UPDATE `events`
   SET `wish_settings` = JSON_SET(
         COALESCE(`wish_settings`, JSON_OBJECT()),
         '$.filter.enabled', TRUE
       )
 WHERE `id` = 30;

UPDATE `events`
   SET `wish_settings` = JSON_SET(`wish_settings`, '$.filter.words', JSON_ARRAY())
 WHERE `id` = 30
   AND JSON_EXTRACT(`wish_settings`, '$.filter.words') IS NULL;

-- 2) add each word once
UPDATE `events`
   SET `wish_settings` = JSON_ARRAY_APPEND(`wish_settings`, '$.filter.words',
         JSON_OBJECT('word', 'stupid', 'replace', '***'))
 WHERE `id` = 30
   AND JSON_SEARCH(`wish_settings`, 'one', 'stupid', NULL, '$.filter.words[*].word') IS NULL;

UPDATE `events`
   SET `wish_settings` = JSON_ARRAY_APPEND(`wish_settings`, '$.filter.words',
         JSON_OBJECT('word', 'idiot', 'replace', '***'))
 WHERE `id` = 30
   AND JSON_SEARCH(`wish_settings`, 'one', 'idiot', NULL, '$.filter.words[*].word') IS NULL;

UPDATE `events`
   SET `wish_settings` = JSON_ARRAY_APPEND(`wish_settings`, '$.filter.words',
         JSON_OBJECT('word', 'fake', 'replace', '***'))
 WHERE `id` = 30
   AND JSON_SEARCH(`wish_settings`, 'one', 'fake', NULL, '$.filter.words[*].word') IS NULL;

UPDATE `events`
   SET `wish_settings` = JSON_ARRAY_APPEND(`wish_settings`, '$.filter.words',
         JSON_OBJECT('word', 'spam', 'replace', '***'))
 WHERE `id` = 30
   AND JSON_SEARCH(`wish_settings`, 'one', 'spam', NULL, '$.filter.words[*].word') IS NULL;

-- check
SELECT `id`, JSON_EXTRACT(`wish_settings`, '$.filter') AS `filter` FROM `events` WHERE `id` = 30;
