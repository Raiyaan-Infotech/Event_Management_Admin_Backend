-- Vendor website newsletter subscribers (footer email signups).
-- Separate from vendor_clients: stores just the subscribed email per vendor.
-- Run against local + live `event_` DBs.

CREATE TABLE IF NOT EXISTS `vendor_subscribers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `vendor_id` INT UNSIGNED NOT NULL,
  `company_id` INT DEFAULT NULL,
  `email` VARCHAR(190) NOT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vendor_subscribers_vendor` (`vendor_id`),
  KEY `idx_vendor_subscribers_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
