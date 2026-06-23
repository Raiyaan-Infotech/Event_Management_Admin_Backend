-- Restore the Color Palettes module (website builder) with the new 4 semantic
-- colors: Primary Background, Primary Text, Secondary Text, Paragraph.
-- Run against local + live `event_` DBs.

CREATE TABLE IF NOT EXISTS `color_palettes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `company_id` INT DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `primary_bg_color` VARCHAR(50) DEFAULT NULL,
  `primary_text_color` VARCHAR(50) DEFAULT NULL,
  `secondary_text_color` VARCHAR(50) DEFAULT NULL,
  `paragraph_color` VARCHAR(50) DEFAULT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active',
  `created_by` INT DEFAULT NULL,
  `updated_by` INT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_color_palettes_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Module + permissions
INSERT IGNORE INTO `modules` (`name`, `slug`, `description`, `company_id`, `is_active`) VALUES
('Color Palettes', 'color_palettes', 'Manage website builder color palettes', 1, 1);

INSERT IGNORE INTO `permissions` (`name`, `slug`, `module`, `company_id`, `description`, `is_active`) VALUES
('View Color Palettes',   'color_palettes.view',   'color_palettes', 1, 'View color palettes',   1),
('Create Color Palettes', 'color_palettes.create', 'color_palettes', 1, 'Create color palettes', 1),
('Edit Color Palettes',   'color_palettes.edit',   'color_palettes', 1, 'Edit color palettes',   1),
('Delete Color Palettes', 'color_palettes.delete', 'color_palettes', 1, 'Delete color palettes', 1);

UPDATE `permissions` p
JOIN `modules` m ON m.`slug` = p.`module`
SET p.`module_id` = m.`id`
WHERE p.`module` = 'color_palettes';

-- Grant to SuperAdmin (role 2) and Admin (role 3)
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 2, p.id, 1, 0 FROM `permissions` p WHERE p.`module` = 'color_palettes';

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 3, p.id, 1, 0 FROM `permissions` p WHERE p.`module` = 'color_palettes';

-- Settings card translation keys
INSERT INTO `translation_keys` (`key`, `default_value`, `group`, `company_id`) VALUES
('settings.color_palettes',      'Color Palettes',                          'settings', 1),
('settings.color_palettes_desc', 'Manage website builder color palettes',   'settings', 1),
('nav.color_palettes',           'Color Palettes',                          'nav',      1)
ON DUPLICATE KEY UPDATE `default_value` = VALUES(`default_value`), `group` = VALUES(`group`);

INSERT IGNORE INTO `translations` (`translation_key_id`, `language_id`, `company_id`, `value`, `status`, `is_active`)
SELECT tk.id, 1, 1, tk.default_value, 'reviewed', 1 FROM `translation_keys` tk
WHERE tk.`key` IN ('settings.color_palettes', 'settings.color_palettes_desc', 'nav.color_palettes');
