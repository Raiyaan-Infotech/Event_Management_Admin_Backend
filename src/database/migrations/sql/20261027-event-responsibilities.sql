-- Responsibilities — its own admin module under Menu Management (Jamal,
-- 2026-10-27). Replaces the Responsibilities field on the Menu form
-- (event_menus.responsibilities, 2026-10-26). One row = one responsibility
-- (label name + description) for one event category; the app's Contact Person
-- profile shows the event category's list. NULL category = the fallback list.
-- Same shape as guest_relationship_options.
CREATE TABLE IF NOT EXISTS `event_responsibilities` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_category_id` INT UNSIGNED NULL,
  `name`              VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description`       TEXT COLLATE utf8mb4_unicode_ci,
  `icon`              VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `color`             VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order`        INT NOT NULL DEFAULT 0,
  `is_active`         TINYINT NOT NULL DEFAULT 1 COMMENT '0=inactive, 1=active, 2=pending approval',
  `company_id`        INT UNSIGNED DEFAULT NULL,
  `created_by`        INT UNSIGNED DEFAULT NULL,
  `updated_by`        INT UNSIGNED DEFAULT NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_event_responsibilities_listing` (`company_id`, `deleted_at`, `is_active`, `sort_order`),
  KEY `idx_event_responsibilities_scope` (`company_id`, `event_category_id`, `deleted_at`, `is_active`, `sort_order`),
  KEY `fk_event_responsibilities_category` (`event_category_id`),
  CONSTRAINT `fk_event_responsibilities_category` FOREIGN KEY (`event_category_id`)
    REFERENCES `event_categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed (done by src/database/tools/apply-event-responsibilities.js, per
-- category): the names on each Contact Person menu's old list
-- (event_menus.responsibilities) become rows for that menu's category.
