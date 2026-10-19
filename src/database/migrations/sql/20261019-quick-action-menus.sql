-- Home Quick Action menus (2026-10-19). Same as
-- src/database/tools/apply-quick-action-menus.js (prefer the tool: it reports
-- what it does and is a dry run by default).
--
-- 1. event_menus.menu_group gains 'quick_action' — a menu for the app's Home
--    Quick Actions only, never a tile inside an event.
-- 2. Four such menus (QR Code, Notifications, My Plan, My Briefcase) in the
--    Agenda menu's category / company, Add-on, granted to every plan.
-- Re-runnable: existing slugs are skipped.

ALTER TABLE `event_menus`
  MODIFY `menu_group` enum('core','addon','quick_action') NOT NULL DEFAULT 'core';

SET @cat := (SELECT event_category_id FROM event_menus WHERE slug = 'agenda' AND deleted_at IS NULL ORDER BY id LIMIT 1);
SET @co  := (SELECT company_id FROM event_menus WHERE slug = 'agenda' AND deleted_at IS NULL ORDER BY id LIMIT 1);
SET @s   := (SELECT COALESCE(MAX(sort_order), 0) FROM event_menus WHERE deleted_at IS NULL);

INSERT INTO event_menus (name, slug, description, menu_group, event_category_id, is_default, icon, color, sort_order, is_active, company_id, created_at, updated_at)
SELECT * FROM (
  SELECT 'QR Code' AS name, 'qr-code' AS slug, 'Open the event invitation QR code.' AS description, 'quick_action' AS g, @cat AS c, 0 AS d, 'mdi:qrcode' AS i, NULL AS col, @s + 1 AS so, 1 AS a, @co AS co, NOW() AS ca, NOW() AS ua
  UNION ALL SELECT 'Notifications', 'notifications', 'Open your notifications.', 'quick_action', @cat, 0, 'mdi:bell-outline', NULL, @s + 2, 1, @co, NOW(), NOW()
  UNION ALL SELECT 'My Plan', 'my-plan', 'Your plan limits: storage, photos, videos, guests and participants.', 'quick_action', @cat, 0, 'mdi:crown-outline', NULL, @s + 3, 1, @co, NOW(), NOW()
  UNION ALL SELECT 'My Briefcase', 'my-briefcase', 'Your briefcase (coming soon).', 'quick_action', @cat, 0, 'mdi:briefcase-outline', NULL, @s + 4, 1, @co, NOW(), NOW()
) AS m
WHERE NOT EXISTS (SELECT 1 FROM event_menus e WHERE e.slug = m.slug);

INSERT INTO subscription_plan_menus (plan_id, menu_id, sort_order, created_at, updated_at)
SELECT p.id, e.id, 999, NOW(), NOW()
  FROM subscription_plans p
  JOIN event_menus e ON e.slug IN ('qr-code', 'notifications', 'my-plan', 'my-briefcase') AND e.deleted_at IS NULL
 WHERE p.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM subscription_plan_menus g WHERE g.plan_id = p.id AND g.menu_id = e.id);

-- Check.
SELECT id, name, slug, menu_group FROM event_menus WHERE menu_group = 'quick_action';
