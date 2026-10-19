-- Home → Quick Actions customised by the organizer (2026-10-19):
-- website_clients.quick_actions JSON = the chosen menu slugs, in order
-- (base slugs, e.g. ["gallery","agenda","wishes"]). NULL = the default set.
-- Only menus the account's plan grants are ever stored or shown; Edit Event is
-- the app's own fixed first tile and is never in this list.
-- Re-runnable: the column is added only when it is missing.

SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'quick_actions');
SET @sql := IF(@has = 0,
  'ALTER TABLE `website_clients` ADD COLUMN `quick_actions` json DEFAULT NULL COMMENT ''Home Quick Actions: ordered menu slugs from the plan, NULL = default set''',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check: the column exists.
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'quick_actions';
