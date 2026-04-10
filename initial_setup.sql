-- =============================================================================
-- Admin Panel - Initial Database Setup (Event Invite White Label)
-- MySQL: root / root
-- =============================================================================

CREATE DATABASE IF NOT EXISTS event_
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- =============================================================================
-- CORE TABLES
-- =============================================================================

use event_;
CREATE TABLE IF NOT EXISTS `companies` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(200) NOT NULL,
  `slug`       VARCHAR(200) NOT NULL UNIQUE,
  `domain`     VARCHAR(255) DEFAULT NULL,
  `logo`       VARCHAR(500) DEFAULT NULL,
  `email`      VARCHAR(255) DEFAULT NULL,
  `phone`      VARCHAR(20)  DEFAULT NULL,
  `address`    TEXT         DEFAULT NULL,
  `timezone`   VARCHAR(100) DEFAULT 'UTC',
  `settings`   JSON         DEFAULT NULL,
  `max_users`  INT          DEFAULT NULL,
  `is_active`  TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by` INT          DEFAULT NULL,
  `updated_by` INT          DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roles
CREATE TABLE IF NOT EXISTS `roles` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL,
  `slug`        VARCHAR(100) NOT NULL,
  `description` TEXT         DEFAULT NULL,
  `level`       INT          NOT NULL DEFAULT 0 COMMENT 'developer=1000,super_admin=100,admin=50,subadmin=25,custom=10',
  `company_id`  INT          DEFAULT NULL,
  `vendor_id`   INT          DEFAULT NULL,
  `is_default`  TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`   TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `approved_at` DATETIME     DEFAULT NULL,
  `created_by`  INT          DEFAULT NULL,
  `updated_by`  INT          DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_roles_company` (`company_id`),
  KEY `idx_roles_vendor` (`vendor_id`),
  KEY `idx_roles_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users
CREATE TABLE IF NOT EXISTS `users` (
  `id`                     INT          NOT NULL AUTO_INCREMENT,
  `full_name`              VARCHAR(200) NOT NULL,
  `email`                  VARCHAR(255) NOT NULL,
  `password`               VARCHAR(255) NOT NULL,
  `phone`                  VARCHAR(20)  DEFAULT NULL,
  `avatar`                 VARCHAR(500) DEFAULT NULL,
  `role_id`                INT          NOT NULL,
  `company_id`             INT          DEFAULT NULL,
  `username`               VARCHAR(100) DEFAULT NULL,
  `dob`                    DATE         DEFAULT NULL,
  `gender`                 ENUM('male','female','other') DEFAULT NULL,
  `marital_status`         ENUM('married','unmarried') DEFAULT NULL,
  `country_id`             INT          DEFAULT NULL,
  `state_id`               INT          DEFAULT NULL,
  `city_id`                INT          DEFAULT NULL,
  `pincode_id`             INT          DEFAULT NULL,
  `address`                TEXT         DEFAULT NULL,
  `department`             VARCHAR(200) DEFAULT NULL,
  `designation`            VARCHAR(200) DEFAULT NULL,
  `doj`                    DATE         DEFAULT NULL,
  `dor`                    DATE         DEFAULT NULL,
  `timezone`               VARCHAR(100) DEFAULT NULL,
  `login_access`           TINYINT      NOT NULL DEFAULT 1,
  `email_verified_at`      DATETIME     DEFAULT NULL,
  `last_login_at`          DATETIME     DEFAULT NULL,
  `password_changed_at`    DATETIME     DEFAULT NULL,
  `password_reset_token`   VARCHAR(255) DEFAULT NULL,
  `password_reset_expires` DATETIME     DEFAULT NULL,
  `is_active`              TINYINT      NOT NULL DEFAULT 0 COMMENT '0=inactive,1=active,2=pending',
  `created_at`             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`             DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_email` (`email`),
  KEY `idx_users_role` (`role_id`),
  KEY `idx_users_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Modules
CREATE TABLE IF NOT EXISTS `modules` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL,
  `slug`        VARCHAR(100) NOT NULL,
  `description` TEXT         DEFAULT NULL,
  `company_id`  INT          DEFAULT NULL,
  `vendor_id`   INT          DEFAULT NULL,
  `is_active`   TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`  INT          DEFAULT NULL,
  `updated_by`  INT          DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Permissions
CREATE TABLE IF NOT EXISTS `permissions` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL,
  `slug`        VARCHAR(100) NOT NULL,
  `company_id`  INT          DEFAULT NULL,
  `vendor_id`   INT          DEFAULT NULL,
  `module_id`   INT          DEFAULT NULL,
  `module`      VARCHAR(100) NOT NULL,
  `description` TEXT         DEFAULT NULL,
  `is_active`   TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`  INT          DEFAULT NULL,
  `updated_by`  INT          DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_permissions_slug` (`slug`),
  KEY `idx_permissions_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Role Permissions
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `id`                INT       NOT NULL AUTO_INCREMENT,
  `role_id`           INT       NOT NULL,
  `permission_id`     INT       NOT NULL,
  `company_id`        INT       DEFAULT NULL,
  `vendor_id`         INT       DEFAULT NULL,
  `requires_approval` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`        DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_permission` (`role_id`, `permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Settings
CREATE TABLE IF NOT EXISTS `settings` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `key`         VARCHAR(100) NOT NULL UNIQUE,
  `value`       TEXT         DEFAULT NULL,
  `group`       VARCHAR(50)  NOT NULL DEFAULT 'general',
  `type`        ENUM('text','textarea','number','boolean','json','file') NOT NULL DEFAULT 'text',
  `description` TEXT         DEFAULT NULL,
  `company_id`  INT          DEFAULT NULL,
  `is_active`   TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`  INT          DEFAULT NULL,
  `updated_by`  INT          DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_settings_group` (`group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Languages
CREATE TABLE IF NOT EXISTS `languages` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL,
  `code`        VARCHAR(10)  NOT NULL UNIQUE,
  `native_name` VARCHAR(100) DEFAULT NULL,
  `direction`   ENUM('ltr','rtl') NOT NULL DEFAULT 'ltr',
  `is_default`  TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`   TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`  INT          DEFAULT NULL,
  `updated_by`  INT          DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Currencies
CREATE TABLE IF NOT EXISTS `currencies` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(100)  NOT NULL,
  `code`           VARCHAR(3)    NOT NULL UNIQUE,
  `symbol`         VARCHAR(10)   DEFAULT NULL,
  `exchange_rate`      DECIMAL(10,4) NOT NULL DEFAULT 1.0000,
  `decimal_places`     INT           NOT NULL DEFAULT 2,
  `decimal_separator`  VARCHAR(5)    NOT NULL DEFAULT '.',
  `thousand_separator` VARCHAR(5)    NOT NULL DEFAULT ',',
  `symbol_position`    ENUM('before','after') NOT NULL DEFAULT 'before',
  `space_between`      TINYINT       NOT NULL DEFAULT 0,
  `is_default`         TINYINT(1)    NOT NULL DEFAULT 0,
  `is_active`      TINYINT       NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`     INT           DEFAULT NULL,
  `updated_by`     INT           DEFAULT NULL,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME      DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Countries
CREATE TABLE IF NOT EXISTS `countries` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(100) NOT NULL,
  `code`          VARCHAR(3)   NOT NULL UNIQUE,
  `flag`          VARCHAR(500) DEFAULT NULL,
  `nationality`   VARCHAR(100) DEFAULT NULL,
  `sort_order`    INT          DEFAULT 0,
  `is_default`    TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`     TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`    INT          DEFAULT NULL,
  `updated_by`    INT          DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- States
CREATE TABLE IF NOT EXISTS `states` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `country_id` INT          NOT NULL,
  `name`       VARCHAR(100) NOT NULL,
  `code`       VARCHAR(10)  DEFAULT NULL,
  `slug`       VARCHAR(100) DEFAULT NULL,
  `sort_order` INT          DEFAULT 0,
  `is_default` TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`  TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by` INT          DEFAULT NULL,
  `updated_by` INT          DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_states_country` (`country_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Districts
CREATE TABLE IF NOT EXISTS `districts` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `state_id`   INT          NOT NULL,
  `country_id` INT          DEFAULT NULL,
  `name`       VARCHAR(100) NOT NULL,
  `slug`       VARCHAR(100) DEFAULT NULL,
  `sort_order` INT          DEFAULT 0,
  `is_default` TINYINT      DEFAULT 0,
  `is_active`  TINYINT      DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by` INT          DEFAULT NULL,
  `updated_by` INT          DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_districts_state` (`state_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `cities` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `city_id`    INT          NOT NULL COMMENT 'References districts.id (parent district)',
  `name`       VARCHAR(200) NOT NULL,
  `pincode`    VARCHAR(20)  DEFAULT NULL,
  `is_default` TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`  TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by` INT          DEFAULT NULL,
  `updated_by` INT          DEFAULT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cities_district` (`city_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `token`      VARCHAR(500) NOT NULL UNIQUE,
  `user_id`    INT          NOT NULL,
  `ip_address` VARCHAR(45)  DEFAULT NULL,
  `user_agent` TEXT         DEFAULT NULL,
  `expires_at` DATETIME     NOT NULL,
  `is_active`  TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_refresh_tokens_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activity Logs
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `user_id`     INT          DEFAULT NULL,
  `action`      VARCHAR(50)  NOT NULL,
  `module`      VARCHAR(100) NOT NULL,
  `description` TEXT         DEFAULT NULL,
  `old_values`  JSON         DEFAULT NULL,
  `new_values`  JSON         DEFAULT NULL,
  `ip_address`  VARCHAR(45)  DEFAULT NULL,
  `user_agent`  TEXT         DEFAULT NULL,
  `url`         VARCHAR(500) DEFAULT NULL,
  `method`      VARCHAR(10)  DEFAULT NULL,
  `company_id`  INT          DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_activity_logs_user` (`user_id`),
  KEY `idx_activity_logs_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email Configs
CREATE TABLE IF NOT EXISTS `email_configs` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100) NOT NULL,
  `from_email`  VARCHAR(255) NOT NULL,
  `from_name`   VARCHAR(100) DEFAULT NULL,
  `driver`      ENUM('smtp','brevo','elasticemail','sendmail') NOT NULL DEFAULT 'smtp',
  `host`        VARCHAR(255) DEFAULT NULL,
  `port`        INT          DEFAULT NULL,
  `username`    VARCHAR(255) DEFAULT NULL,
  `password`    VARCHAR(500) DEFAULT NULL,
  `encryption`  ENUM('tls','ssl','none') DEFAULT 'tls',
  `api_key`     VARCHAR(500) DEFAULT NULL,
  `domain`      VARCHAR(255) DEFAULT NULL,
  `region`      VARCHAR(100) DEFAULT NULL,
  `imap_host`       VARCHAR(255) DEFAULT NULL,
  `imap_port`       INT          DEFAULT 993,
  `imap_encryption` ENUM('ssl','tls','none') DEFAULT 'ssl',
  `imap_enabled`    TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Enable IMAP polling for inbound replies',
  `company_id`  INT          DEFAULT NULL,
  `is_default`  TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`   TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`  INT          DEFAULT NULL,
  `updated_by`  INT          DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email Templates
CREATE TABLE IF NOT EXISTS `email_templates` (
  `id`              INT          NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(100) NOT NULL,
  `slug`            VARCHAR(100) NOT NULL UNIQUE,
  `company_id`      INT          DEFAULT NULL,
  `type`            ENUM('header','footer','template') NOT NULL DEFAULT 'template',
  `subject`         VARCHAR(255) DEFAULT NULL,
  `body`            LONGTEXT     DEFAULT NULL,
  `variables`       JSON         DEFAULT NULL,
  `description`     VARCHAR(500) DEFAULT NULL,
  `header_id`       INT          DEFAULT NULL,
  `footer_id`       INT          DEFAULT NULL,
  `email_config_id` INT          DEFAULT NULL,
  `is_predefined`   TINYINT(1)   NOT NULL DEFAULT 0,
  `is_active`       TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`      INT          DEFAULT NULL,
  `updated_by`      INT          DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_campaigns` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `name`              VARCHAR(100) NOT NULL,
  `slug`              VARCHAR(100) NOT NULL UNIQUE,
  `company_id`        INT          DEFAULT NULL,
  `description`       TEXT         DEFAULT NULL,
  `email_template_id` INT          NOT NULL,
  `email_config_id`   INT          DEFAULT NULL,
  `campaign_type`     ENUM('holiday','scheduled','recurring') NOT NULL,
  `holiday_name`      VARCHAR(100) DEFAULT NULL,
  `holiday_month`     INT          DEFAULT NULL,
  `holiday_day`       INT          DEFAULT NULL,
  `scheduled_date`    DATE         DEFAULT NULL,
  `scheduled_time`    TIME         DEFAULT NULL,
  `recurring_pattern` ENUM('daily','weekly','monthly','yearly') DEFAULT NULL,
  `recurring_day`     INT          DEFAULT NULL,
  `target_audience`   ENUM('all_users','active_users','verified_users','custom') NOT NULL DEFAULT 'all_users',
  `target_roles`      JSON         DEFAULT NULL,
  `variable_mappings` JSON         DEFAULT NULL,
  `total_recipients`  INT          NOT NULL DEFAULT 0,
  `total_sent`        INT          NOT NULL DEFAULT 0,
  `total_failed`      INT          NOT NULL DEFAULT 0,
  `last_run_at`       DATETIME     DEFAULT NULL,
  `next_run_at`       DATETIME     DEFAULT NULL,
  `is_active`         TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending (draft)',
  `created_by`        INT          DEFAULT NULL,
  `updated_by`        INT          DEFAULT NULL,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email Queue
CREATE TABLE IF NOT EXISTS `email_queue` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `company_id`      INT          DEFAULT NULL,
  `campaign_id`     INT          NOT NULL,
  `user_id`         INT          NOT NULL,
  `email`           VARCHAR(255) NOT NULL,
  `subject`         VARCHAR(255) NOT NULL,
  `body`            LONGTEXT     NOT NULL,
  `status`          ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
  `priority`        INT          NOT NULL DEFAULT 5 COMMENT '1=highest,10=lowest',
  `attempts`        INT          NOT NULL DEFAULT 0,
  `max_attempts`    INT          NOT NULL DEFAULT 3,
  `last_error`      TEXT         DEFAULT NULL,
  `scheduled_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at`    DATETIME     DEFAULT NULL,
  `sent_at`         DATETIME     DEFAULT NULL,
  `email_config_id` INT          DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_queue_status_scheduled` (`status`, `scheduled_at`),
  KEY `idx_queue_campaign_user` (`campaign_id`, `user_id`),
  KEY `idx_queue_priority` (`priority`, `scheduled_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email Sent Logs
CREATE TABLE IF NOT EXISTS `email_sent_logs` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `company_id`      INT          DEFAULT NULL,
  `campaign_id`     INT          NOT NULL,
  `user_id`         INT          NOT NULL,
  `email`           VARCHAR(255) NOT NULL,
  `subject`         VARCHAR(255) DEFAULT NULL,
  `sent_at`         DATETIME     DEFAULT NULL,
  `response`        TEXT         DEFAULT NULL,
  `email_config_id` INT          DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Translation Keys
CREATE TABLE IF NOT EXISTS `translation_keys` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `key`           VARCHAR(255) NOT NULL UNIQUE,
  `company_id`    INT          DEFAULT NULL,
  `default_value` TEXT         DEFAULT NULL,
  `description`   VARCHAR(500) DEFAULT NULL,
  `group`         VARCHAR(50)  NOT NULL DEFAULT 'common',
  `created_by`    INT          DEFAULT NULL,
  `updated_by`    INT          DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_translation_keys_group` (`group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `translations` (
  `id`                 INT      NOT NULL AUTO_INCREMENT,
  `company_id`         INT      DEFAULT NULL,
  `translation_key_id` INT      NOT NULL,
  `language_id`        INT      NOT NULL,
  `value`              TEXT     DEFAULT NULL,
  `status`             ENUM('auto','reviewed') NOT NULL DEFAULT 'auto',
  `is_active`          TINYINT  NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active,2=pending',
  `created_by`         INT      DEFAULT NULL,
  `updated_by`         INT      DEFAULT NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`         DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_translation_key_lang` (`translation_key_id`, `language_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `missing_translation_keys` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `key`               VARCHAR(255) NOT NULL UNIQUE,
  `company_id`        INT          DEFAULT NULL,
  `default_value`     TEXT         DEFAULT NULL,
  `page_url`          VARCHAR(500) DEFAULT NULL,
  `report_count`      INT          NOT NULL DEFAULT 1,
  `first_reported_at` DATETIME     DEFAULT NULL,
  `last_reported_at`  DATETIME     DEFAULT NULL,
  `is_active`         TINYINT      NOT NULL DEFAULT 1 COMMENT '0=resolved/ignored,1=pending,2=in-progress',
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_missing_key` (`key`),
  KEY `idx_missing_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Approval Requests
-- is_active: 0=rejected, 1=approved, 2=pending (awaiting super admin)
CREATE TABLE IF NOT EXISTS `approval_requests` (
  `id`              INT          NOT NULL AUTO_INCREMENT,
  `company_id`      INT          DEFAULT NULL,
  `requester_id`    INT          NOT NULL,
  `approver_id`     INT          DEFAULT NULL,
  `module_slug`     VARCHAR(100) NOT NULL,
  `permission_slug` VARCHAR(100) NOT NULL,
  `action`          VARCHAR(50)  NOT NULL,
  `resource_type`   VARCHAR(50)  NOT NULL,
  `resource_id`     INT          DEFAULT NULL,
  `request_data`    JSON         DEFAULT NULL,
  `old_data`        JSON         DEFAULT NULL,
  `review_notes`    TEXT         DEFAULT NULL,
  `reviewed_at`     DATETIME     DEFAULT NULL,
  `is_active`       TINYINT      NOT NULL DEFAULT 2 COMMENT '0=rejected,1=approved,2=pending',
  `created_by`      INT          DEFAULT NULL,
  `updated_by`      INT          DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_approvals_active` (`is_active`),
  KEY `idx_approvals_requester` (`requester_id`),
  KEY `idx_approvals_module` (`module_slug`),
  KEY `idx_approvals_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plugins
CREATE TABLE IF NOT EXISTS `plugins` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `slug`         VARCHAR(100) NOT NULL,
  `name`         VARCHAR(100) NOT NULL,
  `description`  TEXT         DEFAULT NULL,
  `category`     VARCHAR(50)  NOT NULL DEFAULT 'general',
  `icon`         VARCHAR(100) DEFAULT NULL,
  `is_active`    TINYINT      NOT NULL DEFAULT 0 COMMENT '0=disabled,1=enabled',
  `config_group` VARCHAR(100) DEFAULT NULL,
  `config_route` VARCHAR(255) DEFAULT NULL,
  `company_id`   INT          DEFAULT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`   DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_plugin_slug_company` (`slug`, `company_id`),
  KEY `idx_plugins_company`  (`company_id`),
  KEY `idx_plugins_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payments
CREATE TABLE IF NOT EXISTS `payments` (
  `id`                     INT            NOT NULL AUTO_INCREMENT,
  `company_id`             INT            DEFAULT NULL,
  `user_id`                INT            DEFAULT NULL,
  `amount`                 DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  `currency`               VARCHAR(10)    NOT NULL DEFAULT 'USD',
  `status`                 ENUM('pending','completed','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
  `gateway`                VARCHAR(50)    DEFAULT NULL COMMENT 'stripe, paypal, razorpay, etc.',
  `gateway_transaction_id` VARCHAR(255)   DEFAULT NULL,
  `description`            TEXT           DEFAULT NULL,
  `metadata`               JSON           DEFAULT NULL,
  `created_at`             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`             DATETIME       DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_payments_company` (`company_id`),
  KEY `idx_payments_user`    (`user_id`),
  KEY `idx_payments_status`  (`status`),
  KEY `idx_payments_gateway` (`gateway`),
  KEY `idx_payments_txn`     (`gateway_transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `faq_categories` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `company_id`  INT          NOT NULL DEFAULT 1,
  `name`        VARCHAR(255) NOT NULL,
  `description` TEXT         DEFAULT NULL,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `is_active`   TINYINT      NOT NULL DEFAULT 1                COMMENT '0=inactive,1=active',
  `created_by`  INT          DEFAULT NULL,
  `updated_by`  INT          DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_faq_cat_company` (`company_id`),
  KEY `idx_faq_cat_active` (`is_active`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FAQs
CREATE TABLE IF NOT EXISTS `faqs` (
  `id`              INT          NOT NULL AUTO_INCREMENT,
  `company_id`      INT          NOT NULL DEFAULT 1,
  `faq_category_id` INT          NOT NULL,
  `question`        TEXT         NOT NULL,
  `answer`          LONGTEXT     NOT NULL,
  `sort_order`      INT          NOT NULL DEFAULT 0,
  `is_active`       TINYINT      NOT NULL DEFAULT 1                COMMENT '0=inactive,1=active',
  `created_by`      INT          DEFAULT NULL,
  `updated_by`      INT          DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_faqs_company` (`company_id`),
  KEY `idx_faqs_category` (`faq_category_id`),
  KEY `idx_faqs_active` (`is_active`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


INSERT INTO `languages` (`name`, `code`, `native_name`, `direction`, `is_default`, `is_active`) VALUES
  ('English', 'en', 'English', 'ltr', 1, 1)
ON DUPLICATE KEY UPDATE `is_default` = 1;

-- Default Currency
INSERT INTO `currencies` (`name`, `code`, `symbol`, `exchange_rate`, `decimal_places`, `is_default`, `is_active`) VALUES
  ('US Dollar', 'USD', '$', 1.0000, 2, 1, 1)
ON DUPLICATE KEY UPDATE `is_default` = 1;

-- Default Settings
INSERT INTO `settings` (`key`, `value`, `group`, `type`, `description`, `company_id`, `is_active`) VALUES
  ('site_name',        'Admin Dashboard',      'general',    'text',    'Application name',        1, 1),
  ('site_email',       'admin@example.com',    'general',    'text',    'Site contact email',      1, 1),
  ('site_url',         'http://localhost:3000','general',    'text',    'Frontend URL',            1, 1),
  ('maintenance_mode', '0',                    'general',    'boolean', 'Maintenance mode toggle', 1, 1),
  ('allow_signup',     '1',                    'general',    'boolean', 'Allow new registrations', 1, 1),
  ('default_timezone', 'Asia/Kolkata',         'general',    'text',    'Default timezone',        1, 1),
  ('default_language', 'en',                   'general',    'text',    'Default language code',   1, 1),
  ('default_currency', 'USD',                  'general',    'text',    'Default currency code',   1, 1),
  ('items_per_page',             '25',  'pagination', 'number',  'Default pagination size',           1, 1),
  ('max_file_size',              '10',  'upload',     'number',  'Max upload size (MB)',               1, 1),
  ('optimize.image_compression', '0',   'optimize',   'boolean', 'Enable image compression on upload', 1, 1),
  ('optimize.image_quality',     '80',  'optimize',   'number',  'Image compression quality (1-100)',  1, 1),
  ('optimize.lazy_loading',      '1',   'optimize',   'boolean', 'Enable lazy loading for images',     1, 1),
  ('optimize.log_retention_days','90',  'optimize',   'number',  'Activity log retention in days',     1, 1),
  -- Media / S3 Storage
  ('driver',                          '',   'media', 'text', 'Storage driver (local or s3)',                1, 1),
  ('aws_access_key',                  '',   'media', 'text', 'AWS S3 access key',                          1, 1),
  ('aws_secret_key',                  '',   'media', 'text', 'AWS S3 secret key',                          1, 1),
  ('aws_region',                      '',   'media', 'text', 'AWS S3 region',                              1, 1),
  ('aws_bucket',                      '',   'media', 'text', 'AWS S3 bucket name',                         1, 1),
  ('aws_url',                         '',   'media', 'text', 'CloudFront or S3 public URL',                1, 1),
  ('aws_endpoint',                    '',   'media', 'text', 'Custom S3-compatible endpoint',              1, 1),
  ('aws_account_id',                  '',   'media', 'text', 'AWS account ID (for R2 etc)',                1, 1),
  ('custom_s3_path',                  '',   'media', 'text', 'Custom path prefix in bucket',               1, 1),
  ('use_path_style_endpoint',         'no', 'media', 'text', 'Use path-style S3 endpoint',                1, 1),
  ('aws_cloudfront_distribution_id',  '',   'media', 'text', 'CloudFront distribution ID for invalidation',1, 1)
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `company_id` = VALUES(`company_id`);

-- =============================================================================
-- DEFAULT COMPANY
-- =============================================================================

INSERT INTO `companies` (`id`, `name`, `slug`, `email`, `is_active`) VALUES
  (1, 'Default Company', 'default-company', 'admin@example.com', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `is_active` = 1;

-- =============================================================================
-- ROLES
-- =============================================================================

INSERT INTO `roles` (`id`, `name`, `slug`, `description`, `level`, `company_id`, `is_default`, `is_active`) VALUES
  (1, 'Developer',   'developer',   'Full system access across all companies. Bypasses all checks.', 1000, NULL, 0, 1),
  (2, 'Super Admin', 'super_admin', 'Full administrative access. Approves pending requests.',         100,  1,    0, 1),
  (3, 'Admin',       'admin',       'Standard administrative access.',                               50,   1,    1, 1)
ON DUPLICATE KEY UPDATE `level` = VALUES(`level`), `company_id` = VALUES(`company_id`), `is_active` = 1;


INSERT INTO `modules` (`name`, `slug`, `description`, `company_id`, `vendor_id`, `is_active`) VALUES
  ('Dashboard',           'dashboard',          'Dashboard and analytics',          NULL, NULL, 1),
  ('Client',              'client',             'Client management',                NULL, NULL, 1),
  ('Staff',               'staff',              'Staff management',                 NULL, NULL, 1),
  ('Roles',               'roles',              'Role management',                  NULL, NULL, 1),
  ('Modules',             'modules',            'Module management',                NULL, NULL, 1),
  ('Communication',       'communication',      'Contact, email and chat',          NULL, NULL, 1),
  ('Reports',             'reports',            'Reports and analytics',            NULL, NULL, 1),
  ('Transactions',        'transactions',       'Transaction management',           NULL, NULL, 1),
  ('Event',               'event',              'Event management',                 NULL, NULL, 1),
  ('Payment',             'payment',            'Payment management',               NULL, NULL, 1),
  ('Settings',            'settings',           'Payment settings, configuration, currency, timezone, activity log', NULL, NULL, 1),
  ('Help',                'help',               'Help and support',                 NULL, NULL, 1),
  ('Website Management',  'website_management', 'Website management',               NULL, NULL, 1)
ON DUPLICATE KEY UPDATE `is_active` = 1;



INSERT INTO `permissions` (`name`, `slug`, `module`, `company_id`, `vendor_id`, `description`, `is_active`) VALUES
  -- Dashboard
  ('View Dashboard',        'dashboard.view',          'dashboard',          NULL, NULL, 'View dashboard',              1),
  -- Client
  ('View Client',           'client.view',             'client',             NULL, NULL, 'View clients',                1),
  ('Create Client',         'client.create',           'client',             NULL, NULL, 'Create clients',              1),
  ('Edit Client',           'client.edit',             'client',             NULL, NULL, 'Edit clients',                1),
  ('Delete Client',         'client.delete',           'client',             NULL, NULL, 'Delete clients',              1),
  -- Staff
  ('View Staff',            'staff.view',              'staff',              NULL, NULL, 'View staff',                  1),
  ('Create Staff',          'staff.create',            'staff',              NULL, NULL, 'Create staff',                1),
  ('Edit Staff',            'staff.edit',              'staff',              NULL, NULL, 'Edit staff',                  1),
  ('Delete Staff',          'staff.delete',            'staff',              NULL, NULL, 'Delete staff',                1),
  -- Roles
  ('View Roles',            'roles.view',              'roles',              NULL, NULL, 'View roles',                  1),
  ('Create Roles',          'roles.create',            'roles',              NULL, NULL, 'Create roles',                1),
  ('Edit Roles',            'roles.edit',              'roles',              NULL, NULL, 'Edit roles',                  1),
  ('Delete Roles',          'roles.delete',            'roles',              NULL, NULL, 'Delete roles',                1),
  -- Modules
  ('View Modules',          'modules.view',            'modules',            NULL, NULL, 'View modules',                1),
  -- Communication
  ('View Communication',    'communication.view',      'communication',      NULL, NULL, 'View communication',          1),
  ('Send Communication',    'communication.send',      'communication',      NULL, NULL, 'Send messages and emails',    1),
  -- Reports
  ('View Reports',          'reports.view',            'reports',            NULL, NULL, 'View reports',                1),
  -- Transactions
  ('View Transactions',     'transactions.view',       'transactions',       NULL, NULL, 'View transactions',           1),
  -- Event
  ('View Event',            'event.view',              'event',              NULL, NULL, 'View events',                 1),
  ('Create Event',          'event.create',            'event',              NULL, NULL, 'Create events',               1),
  ('Edit Event',            'event.edit',              'event',              NULL, NULL, 'Edit events',                 1),
  ('Delete Event',          'event.delete',            'event',              NULL, NULL, 'Delete events',               1),
  -- Payment
  ('View Payment',          'payment.view',            'payment',            NULL, NULL, 'View payments',               1),
  ('Edit Payment',          'payment.edit',            'payment',            NULL, NULL, 'Edit payments',               1),
  -- Settings
  ('View Settings',         'settings.view',           'settings',           NULL, NULL, 'View settings',               1),
  ('Edit Settings',         'settings.edit',           'settings',           NULL, NULL, 'Edit settings',               1),
  -- Help
  ('View Help',             'help.view',               'help',               NULL, NULL, 'View help',                   1),
  -- Website Management
  ('View Website',          'website_management.view', 'website_management', NULL, NULL, 'View website management',     1),
  ('Edit Website',          'website_management.edit', 'website_management', NULL, NULL, 'Edit website management',     1)
ON DUPLICATE KEY UPDATE `is_active` = 1;



SET @pwd = '$2a$12$vs2DUSwLCsy.tV0y0omFT.5XWaCprc7W3TcV0XKeNxnX3B0cFRyW.'; -- 123456

INSERT INTO `users` (`id`, `full_name`, `email`, `password`, `role_id`, `company_id`, `username`, `login_access`, `email_verified_at`, `is_active`) VALUES
  (1, 'Developer',   'developer@admin.com',  @pwd, 1, NULL, 'developer',  1, NOW(), 1),
  (2, 'Super Admin', 'superadmin@admin.com', @pwd, 2, 1,    'superadmin', 1, NOW(), 1),
  (3, 'Admin',       'admin@admin.com',      @pwd, 3, 1,    'admin',      1, NOW(), 1)
ON DUPLICATE KEY UPDATE `password` = VALUES(`password`), `is_active` = 1, `company_id` = VALUES(`company_id`), `email_verified_at` = NOW();

-- Back-fill created_by on roles
SET SQL_SAFE_UPDATES = 0;
UPDATE `roles` SET `created_by` = 1 WHERE `created_by` IS NULL;

-- Link permissions to their modules via module_id
UPDATE `permissions` p
JOIN `modules` m ON m.`slug` = p.`module`
SET p.`module_id` = m.`id`
WHERE p.`module_id` IS NULL;

SET SQL_SAFE_UPDATES = 1;

INSERT INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 3, `id`, 1, 0 FROM `permissions` WHERE `company_id` = 1
ON DUPLICATE KEY UPDATE `requires_approval` = 0, `company_id` = 1;

-- Then flip create/edit/delete/upload/toggle actions to requires_approval = 1
UPDATE `role_permissions` rp
JOIN `permissions` p ON rp.`permission_id` = p.`id`
SET rp.`requires_approval` = 1
WHERE rp.`role_id` = 3
  AND (
    p.`slug` LIKE '%.create'
    OR p.`slug` LIKE '%.edit'
    OR p.`slug` LIKE '%.delete'
    OR p.`slug` LIKE '%.upload'
  );

-- =============================================================================
-- FOREIGN KEY CONSTRAINTS
-- =============================================================================

ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_role`    FOREIGN KEY (`role_id`)    REFERENCES `roles`     (`id`),
  ADD CONSTRAINT `fk_users_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE SET NULL;

ALTER TABLE `role_permissions`
  ADD CONSTRAINT `fk_rp_role`       FOREIGN KEY (`role_id`)       REFERENCES `roles`       (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_rp_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE;

ALTER TABLE `permissions`
  ADD CONSTRAINT `fk_permissions_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE SET NULL;

ALTER TABLE `states`
  ADD CONSTRAINT `fk_states_country` FOREIGN KEY (`country_id`) REFERENCES `countries` (`id`) ON DELETE CASCADE;


ALTER TABLE `cities`
ADD COLUMN `state_id` INT DEFAULT NULL AFTER `city_id`,
ADD KEY `idx_cities_state` (`state_id`),
ADD CONSTRAINT `fk_cities_state`
  FOREIGN KEY (`state_id`) REFERENCES `states`(`id`)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
  

ALTER TABLE `translations`
  ADD CONSTRAINT `fk_translations_key`  FOREIGN KEY (`translation_key_id`) REFERENCES `translation_keys` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_translations_lang` FOREIGN KEY (`language_id`)        REFERENCES `languages`        (`id`) ON DELETE CASCADE;

ALTER TABLE `refresh_tokens`
  ADD CONSTRAINT `fk_refresh_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

ALTER TABLE `activity_logs`
  ADD CONSTRAINT `fk_activity_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;
  
  
  
INSERT INTO `translation_keys` (`key`, `default_value`, `group`, `company_id`) VALUES
  -- nav
  ('nav.navigation',    'Navigation',      'nav', 1),
  ('nav.dashboard',     'Dashboard',       'nav', 1),
  ('nav.companies',     'Companies',       'nav', 1),
  ('nav.approvals',     'Approvals',       'nav', 1),
  ('nav.employees',     'Employees',       'nav', 1),
  ('nav.pages',         'Pages',           'nav', 1),
  ('nav.blog',          'Blog',            'nav', 1),
  ('nav.testimonials',  'Testimonials',    'nav', 1),
  ('nav.ads',           'Ads',             'nav', 1),
  ('nav.announcements', 'Announcements',   'nav', 1),
  ('nav.faqs',          'FAQs',            'nav', 1),
  ('nav.faq_list',      'FAQ List',        'nav', 1),
  ('nav.faq_categories','FAQ Categories',  'nav', 1),
  ('nav.locations',     'Locations',       'nav', 1),
  ('nav.contact',       'Contact',         'nav', 1),
  ('nav.media',         'Media',           'nav', 1),
  ('nav.plugins',       'Plugins',         'nav', 1),
  ('nav.payments',      'Payments',        'nav', 1),
  ('nav.tools',         'Tools',           'nav', 1),
  ('nav.access_control','Access Control',  'nav', 1),
  ('nav.roles',         'Roles',           'nav', 1),
  ('nav.modules',       'Modules',         'nav', 1),
  ('nav.appearance',    'Appearance',      'nav', 1),
  ('nav.theme',         'Theme',           'nav', 1),
  ('nav.menu',          'Menu',            'nav', 1),
  ('nav.theme_option',  'Theme Options',   'nav', 1),
  ('nav.settings',      'Settings',        'nav', 1),
  ('nav.platform_admin','Platform Admin',  'nav', 1),
  ('nav.profile',       'Profile',         'nav', 1),
  ('nav.translations',  'Translations',    'nav', 1),
  -- common
  ('common.name',         'Name',          'common', 1),
  ('common.description',  'Description',   'common', 1),
  ('common.status',       'Status',        'common', 1),
  ('common.actions',      'Actions',       'common', 1),
  ('common.action',       'Action',        'common', 1),
  ('common.active',       'Active',        'common', 1),
  ('common.inactive',     'Inactive',      'common', 1),
  ('common.approved',     'Approved',      'common', 1),
  ('common.create',       'Create',        'common', 1),
  ('common.edit',         'Edit',          'common', 1),
  ('common.delete',       'Delete',        'common', 1),
  ('common.save',         'Save',          'common', 1),
  ('common.saving',       'Saving...',     'common', 1),
  ('common.cancel',       'Cancel',        'common', 1),
  ('common.submit',       'Submit',        'common', 1),
  ('common.loading',      'Loading...',    'common', 1),
  ('common.deleting',     'Deleting...',   'common', 1),
  ('common.changing',     'Changing...',   'common', 1),
  ('common.code',         'Code',          'common', 1),
  ('common.email',        'Email',         'common', 1),
  ('common.user',         'User',          'common', 1),
  ('common.date',         'Date',          'common', 1),
  ('common.page',         'Page',          'common', 1),
  ('common.next',         'Next',          'common', 1),
  ('common.previous',     'Previous',      'common', 1),
  ('common.optional',     'Optional',      'common', 1),
  -- settings
  ('settings.page_desc',          'Manage your application settings',       'settings', 1),
  ('settings.general',            'General',                                 'settings', 1),
  ('settings.general_desc',       'Basic site configuration',               'settings', 1),
  ('settings.email',              'Email',                                   'settings', 1),
  ('settings.email_desc',         'Email provider settings',                'settings', 1),
  ('settings.email_templates',    'Email Templates',                        'settings', 1),
  ('settings.email_templates_desc','Manage email templates',                'settings', 1),
  ('settings.email_campaigns',    'Email Campaigns',                        'settings', 1),
  ('settings.email_campaigns_desc','Manage email campaigns',                'settings', 1),
  ('settings.languages',          'Languages',                              'settings', 1),
  ('settings.languages_desc',     'Manage supported languages',             'settings', 1),
  ('settings.currencies',         'Currencies',                             'settings', 1),
  ('settings.currencies_desc',    'Manage supported currencies',            'settings', 1),
  ('settings.media',              'Media',                                   'settings', 1),
  ('settings.media_desc',         'File upload settings',                   'settings', 1),
  ('settings.translations',       'Translations',                           'settings', 1),
  ('settings.translations_desc',  'Manage translation keys',                'settings', 1),
  ('settings.locations',          'Locations',                              'settings', 1),
  ('settings.locations_desc',     'Manage countries, states, districts and cities', 'settings', 1),
  ('settings.timezone',           'Timezone',                               'settings', 1),
  ('settings.timezone_desc',      'Configure application timezone',         'settings', 1),
  ('settings.site_settings',      'Site Settings',                          'settings', 1),
  ('settings.site_settings_desc', 'Configure site-wide settings',           'settings', 1),
  ('settings.social_login',       'Social Login',                           'settings', 1),
  ('settings.social_login_desc',  'Configure social authentication',        'settings', 1),
  ('settings.website_tracking',   'Website Tracking',                       'settings', 1),
  ('settings.website_tracking_desc','Configure analytics tracking',         'settings', 1),
  ('settings.dashboard_theme',    'Dashboard Theme',                        'settings', 1),
  ('settings.dashboard_theme_desc','Customize dashboard appearance',        'settings', 1),
  ('settings.phone_number',       'Phone Number',                           'settings', 1),
  ('settings.phone_number_desc',  'Configure phone number settings',        'settings', 1),
  -- common.comming (shown in screenshot)
  ('common.comming',              'Coming Soon',                            'common', 1),
  -- dashboard
  ('dashboard.welcome_admin', 'Welcome back, Admin', 'dashboard', 1),
  ('dashboard.quick_actions', 'Quick Actions',       'dashboard', 1),
  -- auth
  ('auth.greeting',     'Hello',           'auth', 1),
  ('auth.welcome',      'Welcome',         'auth', 1),
  ('auth.welcome_back', 'Welcome Back',    'auth', 1),
  ('auth.logout',       'Logout',          'auth', 1),
  -- profile
  ('profile.title',               'Profile',                   'profile', 1),
  ('profile.description',         'Manage your account',       'profile', 1),
  ('profile.my_account',          'My Account',                'profile', 1),
  ('profile.account_details',     'Account Details',           'profile', 1),
  ('profile.account_info',        'Account Info',              'profile', 1),
  ('profile.personal_info',       'Personal Information',      'profile', 1),
  ('profile.personal_info_desc',  'Update your personal info', 'profile', 1),
  ('profile.full_name',           'Full Name',                 'profile', 1),
  ('profile.phone',               'Phone',                     'profile', 1),
  ('profile.last_login',          'Last Login',                'profile', 1),
  ('profile.update_profile',      'Update Profile',            'profile', 1),
  ('profile.change_password',     'Change Password',           'profile', 1),
  ('profile.change_password_desc','Update your password',      'profile', 1),
  ('profile.current_password',    'Current Password',          'profile', 1),
  ('profile.new_password',        'New Password',              'profile', 1),
  ('profile.confirm_new_password','Confirm New Password',      'profile', 1),
  ('profile.confirm_password',    'Confirm Password',          'profile', 1),
  ('profile.enter_current_password','Enter current password',  'profile', 1),
  ('profile.enter_new_password',  'Enter new password',        'profile', 1),
  -- roles
  ('roles.role',           'Role',              'roles', 1),
  ('roles.add_role',       'Add Role',          'roles', 1),
  ('roles.search',         'Search roles...',   'roles', 1),
  ('roles.no_roles_found', 'No roles found',    'roles', 1),
  -- languages
  ('languages.title',            'Languages',                   'languages', 1),
  ('languages.add_language',     'Add Language',                'languages', 1),
  ('languages.add_desc',         'Add a new language',          'languages', 1),
  ('languages.edit_language',    'Edit Language',               'languages', 1),
  ('languages.edit_desc',        'Update language details',     'languages', 1),
  ('languages.native_name',      'Native Name',                 'languages', 1),
  ('languages.direction',        'Direction',                   'languages', 1),
  ('languages.set_default',      'Set as Default',              'languages', 1),
  ('languages.search',           'Search languages...',         'languages', 1),
  ('languages.no_languages_found','No languages found',         'languages', 1),
  ('languages.delete_title',     'Delete Language',             'languages', 1),
  ('languages.translate_all',    'Translate All',               'languages', 1),
  ('languages.translate_all_title','Translate All Keys',        'languages', 1),
  ('languages.translating',      'Translating...',              'languages', 1),
  ('languages.translating_title','Translating',                 'languages', 1),
  ('languages.translating_to',   'Translating to',              'languages', 1),
  -- currencies
  ('currencies.title',              'Currencies',              'currencies', 1),
  ('currencies.add_currency',       'Add Currency',            'currencies', 1),
  ('currencies.add_desc',           'Add a new currency',      'currencies', 1),
  ('currencies.edit_currency',      'Edit Currency',           'currencies', 1),
  ('currencies.edit_desc',          'Update currency details', 'currencies', 1),
  ('currencies.symbol',             'Symbol',                  'currencies', 1),
  ('currencies.exchange_rate',      'Exchange Rate',           'currencies', 1),
  ('currencies.search',             'Search currencies...',    'currencies', 1),
  ('currencies.no_currencies_found','No currencies found',     'currencies', 1),
  ('currencies.delete_confirm',     'Confirm Delete',          'currencies', 1),
  -- translations
  ('translations.total_keys',          'Total Keys',                  'translations', 1),
  ('translations.completion_stats',    'Completion Stats',            'translations', 1),
  ('translations.missing_keys',        'Missing Keys',                'translations', 1),
  ('translations.missing_keys_desc',   'Keys detected but not translated', 'translations', 1),
  ('translations.missing_keys_detected','Missing keys detected',      'translations', 1),
  ('translations.add_key',             'Add Key',                     'translations', 1),
  ('translations.add_key_title',       'Add Translation Key',         'translations', 1),
  ('translations.add_key_desc',        'Create a new translation key','translations', 1),
  ('translations.edit_translations',   'Edit Translations',           'translations', 1),
  ('translations.key',                 'Key',                         'translations', 1),
  ('translations.group',               'Group',                       'translations', 1),
  ('translations.default_value',       'Default Value',               'translations', 1),
  ('translations.description_placeholder','Describe this key...',     'translations', 1),
  ('translations.key_format',          'Use dot notation: group.key', 'translations', 1),
  ('translations.languages',           'Languages',                   'translations', 1),
  ('translations.all_languages',       'All Languages',               'translations', 1),
  ('translations.all_groups',          'All Groups',                  'translations', 1),
  ('translations.all_status',          'All Status',                  'translations', 1),
  ('translations.filter_group',        'Filter by Group',             'translations', 1),
  ('translations.filter_language',     'Filter by Language',          'translations', 1),
  ('translations.filter_status',       'Filter by Status',            'translations', 1),
  ('translations.search_placeholder',  'Search keys...',              'translations', 1),
  ('translations.select_group',        'Select Group',                'translations', 1),
  ('translations.new_group',           'New Group',                   'translations', 1),
  ('translations.no_keys_found',       'No translation keys found',   'translations', 1),
  ('translations.no_keys_with_status', 'No keys with this status',    'translations', 1),
  ('translations.status_auto',         'Auto',                        'translations', 1),
  ('translations.status_reviewed',     'Reviewed',                    'translations', 1),
  ('translations.status_missing',      'Missing',                     'translations', 1),
  ('translations.auto_translate',      'Auto Translate',              'translations', 1),
  ('translations.retranslate',         'Re-translate',                'translations', 1),
  ('translations.english_default',     'English (Default)',           'translations', 1),
  ('translations.english_original',    'English Original',            'translations', 1),
  ('translations.translation_in',      'Translation in',              'translations', 1),
  ('translations.view_resolve',        'View & Resolve',              'translations', 1),
  -- activity
  ('activity.logs',        'Activity Logs',   'activity', 1),
  ('activity.logs_desc',   'User activity audit trail', 'activity', 1),
  ('activity.recent',      'Recent Activity', 'activity', 1),
  ('activity.no_activity', 'No activity yet', 'activity', 1),
  ('activity.view_all',    'View All',        'activity', 1),
  ('activity.date_time',   'Date & Time',     'activity', 1),
  ('activity.ip_address',  'IP Address',      'activity', 1),
  -- platform
  ('platform.page_desc',             'Manage platform settings',      'platform', 1),
  ('platform.system',                'System',                        'platform', 1),
  ('platform.employee_management',   'Employee Management',           'platform', 1),
  ('platform.employees_desc',        'Manage employees and users',    'platform', 1),
  ('platform.roles_desc',            'Manage roles and permissions',  'platform', 1),
  ('platform.modules_desc',          'Manage system modules',         'platform', 1),
  ('platform.activity_desc',         'View user activity logs',       'platform', 1),
  ('platform.cache_manager',         'Cache Manager',                 'platform', 1),
  ('platform.cache_desc',            'Manage application cache',      'platform', 1),
  ('platform.profile_desc',          'Manage your profile',           'platform', 1),
  -- nav (missing ones)
  ('nav.activity_logs',   'Activity Logs',    'nav', 1),
  ('nav.currencies',      'Currencies',       'nav', 1),
  ('nav.email_templates', 'Email Templates',  'nav', 1),
  ('nav.languages',       'Languages',        'nav', 1),
  ('nav.missing_keys',    'Missing Keys',     'nav', 1),
  ('nav.modules',         'Modules',          'nav', 1),
  ('nav.permissions',     'Permissions',      'nav', 1),
  ('nav.platform',        'Platform',         'nav', 1),
  ('nav.configuration',   'Configuration',    'nav', 1),
  -- settings (missing ones)
  ('settings.cache',               'Cache',                  'settings', 1),
  ('settings.cache_desc',          'Manage cache settings',  'settings', 1),
  ('settings.common',              'Common',                 'settings', 1),
  ('settings.localization',        'Localization',           'settings', 1),
  ('settings.optimize',            'Optimize',               'settings', 1),
  ('settings.optimize_desc',       'Performance optimization','settings', 1),
  ('settings.optimize_settings_view','Optimization Settings','settings', 1),
  ('settings.performance',         'Performance',            'settings', 1),
  -- dashboard (missing ones)
  ('dashboard.total_users',   'Total Users',   'dashboard', 1),
  -- languages (missing ones)
  ('languages.delete_confirm',      'Confirm delete?',              'languages', 1),
  ('languages.please_wait',         'Please wait...',               'languages', 1),
  ('languages.translate_all_confirm','Translate all keys?',         'languages', 1),
  ('languages.translating_progress','Translation in progress...',   'languages', 1),
  -- translations (missing ones)
  ('translations.enter_group_name', 'Enter group name', 'translations', 1),
  -- roles (missing ones)
  ('roles.edit',          'Edit Role',         'roles', 1),
  ('roles.manage_roles',  'Manage Roles',      'roles', 1),
  -- appearance
  ('appearance.menu',          'Menu',           'appearance', 1),
  ('appearance.theme',         'Theme',          'appearance', 1),
  ('appearance.theme_options', 'Theme Options',  'appearance', 1),
  -- common (missing)
  ('common.of',                'of',             'common', 1),
  ('common.are_you_sure',      'Are you sure?',  'common', 1),
  ('common.cannot_undo',       'This action cannot be undone.', 'common', 1),
  -- locations tab labels
  ('locations.countries',           'Countries',                              'locations', 1),
  ('locations.states',              'States',                                 'locations', 1),
  ('locations.districts',           'Districts',                              'locations', 1),
  ('locations.cities',              'Cities',                                 'locations', 1),
  ('locations.country',             'Country',                                'locations', 1),
  ('locations.state',               'State',                                  'locations', 1),
  ('locations.district',            'District',                               'locations', 1),
  ('locations.city',                'City',                                   'locations', 1),
  ('locations.pincode',             'Pincode',                                'locations', 1),
  ('locations.slug',                'Slug',                                   'locations', 1),
  ('locations.sort_order',          'Sort Order',                             'locations', 1),
  ('locations.default',             'Default',                                'locations', 1),
  ('locations.is_active',           'Is Active?',                             'locations', 1),
  ('locations.is_default',          'Is Default?',                            'locations', 1),
  -- districts (cities tab)
  ('locations.districts_desc',      'Manage district records',                'locations', 1),
  ('locations.add_district',        'Add District',                           'locations', 1),
  ('locations.edit_district',       'Edit District',                          'locations', 1),
  ('locations.create_district',     'Create District',                        'locations', 1),
  ('locations.update_district',     'Update District',                        'locations', 1),
  ('locations.edit_district_desc',  'Update district details.',               'locations', 1),
  ('locations.add_district_desc',   'Fill in details to create a new district.', 'locations', 1),
  ('locations.no_districts_found',  'No districts found',                     'locations', 1),
  ('locations.search_district',     'Search by name, state or country...',    'locations', 1),
  ('locations.select_district',     'Select District',                        'locations', 1),
  ('locations.all_districts',       'All Districts',                          'locations', 1),
  ('locations.district_placeholder','e.g. Chennai North',                     'locations', 1),
  -- cities (localities tab)
  ('locations.cities_desc',         'Manage cities linked to districts',      'locations', 1),
  ('locations.add_city',            'Add City',                               'locations', 1),
  ('locations.edit_city',           'Edit City',                              'locations', 1),
  ('locations.create_city',         'Create City',                            'locations', 1),
  ('locations.update_city',         'Update City',                            'locations', 1),
  ('locations.edit_city_desc',      'Update city details.',                   'locations', 1),
  ('locations.add_city_desc',       'Fill in details to create a new city.',  'locations', 1),
  ('locations.no_cities_found',     'No cities found',                        'locations', 1),
  ('locations.city_name',           'City Name',                              'locations', 1),
  ('locations.city_name_placeholder','e.g. Andheri West',                    'locations', 1),
  ('locations.search_city',         'Search by city name or pincode...',      'locations', 1),
  ('locations.select_district_hint','Select a district above to view its cities', 'locations', 1),
  -- shared filter
  ('locations.all_countries',       'All Countries',                          'locations', 1),
  ('locations.all_states',          'All States',                             'locations', 1),
  ('locations.select_country',      'Select country...',                      'locations', 1),
  ('locations.select_state',        'Select state...',                        'locations', 1),
  -- CSV import
  ('locations.sample_csv',          'Sample CSV',                             'locations', 1),
  ('locations.import_csv',          'Import CSV',                             'locations', 1),
  ('locations.csv_preview',         'CSV Preview',                            'locations', 1),
  ('locations.csv_preview_desc',    'Review the rows below before importing.','locations', 1),
  ('locations.confirm_import',      'Import',                                 'locations', 1),
  ('locations.no_valid_csv_rows',   'No valid rows found in CSV',             'locations', 1),
  ('locations.imported_districts',  'Import completed',                       'locations', 1),
  ('locations.pending_approval',    'Items pending approval',                 'locations', 1),
  ('locations.import_failed',       'Import failed for some rows',            'locations', 1),
  -- common (extra)
  ('common.save',                   'Save',                                   'common', 1),
  ('common.back_to_list',           'Back to list',                           'common', 1),
  ('common.total',                  'total',                                  'common', 1),
  -- announcements
  ('announcements.title',                'Announcements',                           'announcements', 1),
  ('announcements.desc',                 'Manage site-wide announcements shown to users', 'announcements', 1),
  ('announcements.add',                  'Add Announcement',                        'announcements', 1),
  ('announcements.all',                  'All Announcements',                       'announcements', 1),
  ('announcements.search',               'Search announcements...',                 'announcements', 1),
  ('announcements.name',                 'Name',                                    'announcements', 1),
  ('announcements.name_placeholder',     'Announcement 1',                          'announcements', 1),
  ('announcements.name_hint',            'Name for internal reference only, not visible to users', 'announcements', 1),
  ('announcements.content',             'Content',                                 'announcements', 1),
  ('announcements.content_hint',         'The message that will be displayed to users. Supports HTML formatting.', 'announcements', 1),
  ('announcements.start_date',           'Start date',                              'announcements', 1),
  ('announcements.start_date_hint',      'Announcement will be visible from this date. Leave empty to start immediately.', 'announcements', 1),
  ('announcements.end_date',             'End date',                                'announcements', 1),
  ('announcements.end_date_hint',        'Announcement will be hidden after this date. Leave empty for no expiration.', 'announcements', 1),
  ('announcements.has_action',           'Has action',                              'announcements', 1),
  ('announcements.has_action_hint',      'Add a call-to-action button to your announcement', 'announcements', 1),
  ('announcements.action_label',         'Action label',                            'announcements', 1),
  ('announcements.action_label_placeholder','e.g. Learn More, Shop Now',            'announcements', 1),
  ('announcements.action_label_hint',    'Text displayed on the action button',     'announcements', 1),
  ('announcements.action_url',           'Action URL',                              'announcements', 1),
  ('announcements.action_url_hint',      'URL where users will be redirected when clicking the action button', 'announcements', 1),
  ('announcements.open_in_new_tab',      'Open in new tab',                         'announcements', 1),
  ('announcements.open_in_new_tab_hint', 'Open the action link in a new browser tab', 'announcements', 1),
  ('announcements.is_active',            'Is active',                               'announcements', 1),
  ('announcements.is_active_hint',       'Enable or disable this announcement without deleting it', 'announcements', 1),
  ('announcements.publish',              'Publish',                                 'announcements', 1),
  ('announcements.save_exit',            'Save & Exit',                             'announcements', 1),
  ('announcements.live',                 'Live',                                    'announcements', 1),
  ('announcements.inactive',             'Inactive',                                'announcements', 1),
  ('announcements.cta',                  'CTA',                                     'announcements', 1),
  ('announcements.none_found',           'No announcements found',                  'announcements', 1),
  ('announcements.create_first',         'Create First Announcement',               'announcements', 1),
  ('announcements.create_title',         'Create Announcement',                     'announcements', 1),
  ('announcements.create_desc',          'Add a new announcement for your users',   'announcements', 1),
  ('announcements.edit_title',           'Edit Announcement',                       'announcements', 1),
  ('announcements.not_found',            'Announcement not found.',                 'announcements', 1),
  ('announcements.delete_confirm',       'Delete',                                  'announcements', 1),
  ('announcements.deactivated',          'Announcement deactivated',                'announcements', 1),
  -- contact
  ('nav.contact',                        'Contact Messages',                        'nav', 1),
  ('contacts.description',               'Manage and reply to inquiries sent via the contact form.', 'contacts', 1),
  ('contacts.unread',                    'Unread',                                  'contacts', 1),
  ('contacts.read',                      'Read',                                    'contacts', 1),
  ('contacts.subject',                   'Subject',                                 'contacts', 1),
  ('contacts.no_contacts',               'No contact messages found',               'contacts', 1),
  ('contacts.delete',                    'Delete Contact Message',                  'contacts', 1),
  ('contacts.delete_confirm',            'Are you sure you want to delete this message? This action cannot be undone.', 'contacts', 1),
  ('contacts.not_found',                 'Contact Message Not Found',               'contacts', 1),
  ('contacts.not_found_desc',            'The message you are looking for might have been deleted or does not exist.', 'contacts', 1),
  ('contacts.mark_as_read',              'Mark as Read',                            'contacts', 1),
  ('contacts.status_unread',             'Unread',                                  'contacts', 1),
  ('contacts.status_read',               'Read',                                    'contacts', 1),
  ('contacts.no_subject',                '(No Subject)',                            'contacts', 1),
  ('contacts.reply_history',             'Reply History',                           'contacts', 1),
  ('contacts.send_reply',                'Send a Reply',                            'contacts', 1),
  ('contacts.send_reply_desc',           'Compose an email response to the user.',  'contacts', 1),
  ('contacts.start_reply',               'Write Reply',                             'contacts', 1),
  ('contacts.reply_placeholder',         'Type your response here...',              'contacts', 1),
  ('contacts.sender_info',               'Sender Information',                      'contacts', 1)
ON DUPLICATE KEY UPDATE `default_value` = VALUES(`default_value`), `company_id` = VALUES(`company_id`);




INSERT INTO `plugins` (`slug`, `name`, `description`, `category`, `icon`, `is_active`, `config_group`, `config_route`, `company_id`) VALUES
  -- Content (built-in modules, active by default)
  ('faq',            'FAQ',             'Create frequently asked questions organized by category.',    'content',  'help-circle',  1, NULL, NULL, 1),
  -- Marketing (built-in modules, active by default)
  -- General (built-in modules, active by default)
  ('locations',      'Locations',       'Manage countries, states, districts, and cities.',           'general',  'map-pin',      1, NULL, NULL, 1),
  -- Authentication
  ('google-oauth',       'Google OAuth',        'Allow users to sign in with their Google account.',            'authentication', 'google',       0, 'social_login', '/admin/settings/social-login',   1),
  ('facebook-oauth',     'Facebook OAuth',      'Allow users to sign in with their Facebook account.',          'authentication', 'facebook',     0, 'social_login', '/admin/settings/social-login',   1),
  -- Analytics
  ('google-tag-manager', 'Google Tag Manager',  'Manage and deploy marketing tags without editing code.',       'analytics',      'tag',          0, 'analytics',    '/admin/settings/website-tracking',1),
  ('google-analytics',   'Google Analytics 4',  'Track website traffic and user engagement with GA4.',          'analytics',      'bar-chart',    0, 'analytics',    '/admin/settings/website-tracking',1),
  -- Storage
  ('amazon-s3',          'Amazon S3',           'Store and serve uploaded files via Amazon S3.',               'storage',        'cloud',        0, 'media',        '/admin/settings/media',          1),
  ('cloudflare-r2',      'Cloudflare R2',       'Zero-egress object storage compatible with S3 API.',          'storage',        'cloud',        0, 'media',        '/admin/settings/media',          1),
  ('digitalocean-spaces','DigitalOcean Spaces', 'Scalable object storage from DigitalOcean.',                  'storage',        'cloud',        0, 'media',        '/admin/settings/media',          1),
  ('wasabi',             'Wasabi Storage',      'Hot cloud storage — fast, low-cost, reliable.',               'storage',        'cloud',        0, 'media',        '/admin/settings/media',          1),
  -- Maps
  ('google-maps',        'Google Maps',         'Embed maps and location services powered by Google.',         'maps',           'map-pin',      0, 'google_maps',  '/admin/payments/google-maps',    1),
  -- Payment
  ('stripe',             'Stripe Payments',     'Accept online payments with cards, wallets, and more via Stripe.', 'payment',   'credit-card',  0, 'stripe',       '/admin/payments/stripe',         1),
  ('paypal',             'PayPal',              'Fast and trusted global payments via PayPal.',                'payment',        'credit-card',  0, 'paypal',       '/admin/payments/paypal',         1),
  ('razorpay',           'Razorpay',            'Accept payments via cards, UPI, wallets & more (India-focused).','payment',     'credit-card',  0, 'razorpay',     '/admin/payments/razorpay',       1),
  ('paystack',           'Paystack',            'Simple and reliable payments across Africa.',                 'payment',        'credit-card',  0, 'paystack',     '/admin/payments/paystack',       1),
  ('mollie',             'Mollie',              'Effortless European online payments.',                        'payment',        'credit-card',  0, 'mollie',       '/admin/payments/mollie',         1),
  ('flutterwave',        'Flutterwave',         'Pan-African payment infrastructure.',                         'payment',        'credit-card',  0, 'flutterwave',  '/admin/payments/flutterwave',    1),
  -- Security
  ('recaptcha',          'Google reCAPTCHA',    'Protect your forms from bots with Google reCAPTCHA.',        'security',       'shield',       0, 'recaptcha',    '/admin/plugins/recaptcha/config',1),
  -- Communication
  ('twilio',             'Twilio SMS',          'Send SMS notifications and OTPs via Twilio.',                'communication',  'message-square',0,'twilio',       '/admin/plugins/twilio/config',   1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`), `config_route` = VALUES(`config_route`);



INSERT INTO `settings` (`key`, `value`, `group`, `type`, `description`, `company_id`, `is_active`) VALUES
  -- Stripe
  ('stripe_enabled',         'false', 'stripe', 'boolean', 'Enable Stripe gateway',         1, 1),
  ('stripe_is_default',      'false', 'stripe', 'boolean', 'Set Stripe as default',         1, 1),
  ('stripe_publishable_key', '',      'stripe', 'text',    'Stripe publishable/public key', 1, 1),
  ('stripe_secret_key',      '',      'stripe', 'text',    'Stripe secret key',             1, 1),
  ('stripe_webhook_secret',  '',      'stripe', 'text',    'Stripe webhook signing secret', 1, 1),
  ('stripe_test_mode',       'true',  'stripe', 'boolean', 'Use Stripe test mode keys',     1, 1),
  ('stripe_payment_type',    'checkout','stripe','text',   'Stripe payment UI type',        1, 1),
  ('stripe_processing_fee',  '0',     'stripe', 'number',  'Processing fee percentage',     1, 1),
  ('stripe_currency',        'USD',   'stripe', 'text',    'Default currency',              1, 1),
  -- PayPal
  ('paypal_enabled',         'false', 'paypal', 'boolean', 'Enable PayPal gateway',         1, 1),
  ('paypal_is_default',      'false', 'paypal', 'boolean', 'Set PayPal as default',         1, 1),
  ('paypal_client_id',       '',      'paypal', 'text',    'PayPal client ID',              1, 1),
  ('paypal_secret',          '',      'paypal', 'text',    'PayPal client secret',          1, 1),
  ('paypal_mode',            'sandbox','paypal','text',    'PayPal mode: sandbox or live',  1, 1),
  ('paypal_processing_fee',  '0',     'paypal', 'number',  'Processing fee percentage',     1, 1),
  ('paypal_currency',        'USD',   'paypal', 'text',    'Default currency',              1, 1),
  -- Razorpay
  ('razorpay_enabled',       'false', 'razorpay','boolean','Enable Razorpay gateway',       1, 1),
  ('razorpay_is_default',    'false', 'razorpay','boolean','Set Razorpay as default',       1, 1),
  ('razorpay_key_id',        '',      'razorpay','text',   'Razorpay key ID',               1, 1),
  ('razorpay_key_secret',    '',      'razorpay','text',   'Razorpay key secret',           1, 1),
  ('razorpay_test_mode',     'true',  'razorpay','boolean','Use Razorpay test mode',        1, 1),
  ('razorpay_processing_fee','0',     'razorpay','number', 'Processing fee percentage',     1, 1),
  ('razorpay_currency',      'INR',   'razorpay','text',   'Default currency',              1, 1),
  -- Paystack
  ('paystack_enabled',       'false', 'paystack','boolean','Enable Paystack gateway',       1, 1),
  ('paystack_is_default',    'false', 'paystack','boolean','Set Paystack as default',       1, 1),
  ('paystack_public_key',    '',      'paystack','text',   'Paystack public key',           1, 1),
  ('paystack_secret_key',    '',      'paystack','text',   'Paystack secret key',           1, 1),
  ('paystack_test_mode',     'true',  'paystack','boolean','Use Paystack test mode',        1, 1),
  ('paystack_processing_fee','0',     'paystack','number', 'Processing fee percentage',     1, 1),
  ('paystack_currency',      'NGN',   'paystack','text',   'Default currency',              1, 1),
  -- Mollie
  ('mollie_enabled',         'false', 'mollie', 'boolean', 'Enable Mollie gateway',         1, 1),
  ('mollie_is_default',      'false', 'mollie', 'boolean', 'Set Mollie as default',         1, 1),
  ('mollie_api_key',         '',      'mollie', 'text',    'Mollie API key',                1, 1),
  ('mollie_test_mode',       'true',  'mollie', 'boolean', 'Use Mollie test mode',          1, 1),
  ('mollie_processing_fee',  '0',     'mollie', 'number',  'Processing fee percentage',     1, 1),
  -- Flutterwave
  ('flutterwave_enabled',        'false', 'flutterwave','boolean','Enable Flutterwave gateway',    1, 1),
  ('flutterwave_is_default',     'false', 'flutterwave','boolean','Set Flutterwave as default',    1, 1),
  ('flutterwave_public_key',     '',      'flutterwave','text',   'Flutterwave public key',        1, 1),
  ('flutterwave_secret_key',     '',      'flutterwave','text',   'Flutterwave secret key',        1, 1),
  ('flutterwave_encryption_key', '',      'flutterwave','text',   'Flutterwave encryption key',    1, 1),
  ('flutterwave_test_mode',      'true',  'flutterwave','boolean','Use Flutterwave test mode',     1, 1),
  ('flutterwave_processing_fee', '0',     'flutterwave','number', 'Processing fee percentage',     1, 1),
  ('flutterwave_currency',       'NGN',   'flutterwave','text',   'Default currency',              1, 1)
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);


SET SQL_SAFE_UPDATES = 0;
UPDATE `translation_keys` SET `company_id` = 1 WHERE `company_id` IS NULL;
SET SQL_SAFE_UPDATES = 1;


INSERT INTO `translations` (`translation_key_id`, `language_id`, `company_id`, `value`, `status`, `is_active`)
SELECT tk.id, 1, 1, tk.default_value, 'reviewed', 1
FROM `translation_keys` tk
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `status` = 'reviewed', `company_id` = 1;

CREATE TABLE IF NOT EXISTS `vendors` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id`      INT UNSIGNED NULL,

  -- Company Info
  `company_name`    VARCHAR(255) NOT NULL,
  `company_logo`    VARCHAR(500) NULL,
  `country_id`      INT          NULL,
  `state_id`        INT          NULL,
  `city_id`         INT          NULL,
  `pincode_id`      INT          NULL,
  `latitude`        DECIMAL(10,7) NULL,
  `longitude`       DECIMAL(10,7) NULL,
  `reg_no`          VARCHAR(100) NULL,
  `gst_no`          VARCHAR(100) NULL,
  `company_address` TEXT NULL,
  `about_us`        TEXT NULL,
  `company_contact` VARCHAR(50)  NULL,
  `landline`        VARCHAR(50)  NULL,
  `company_email`   VARCHAR(255) NULL,
  `website`         VARCHAR(500) NULL,
  `youtube`         VARCHAR(500) NULL,
  `facebook`        VARCHAR(500) NULL,
  `instagram`       VARCHAR(500) NULL,
  `twitter`         VARCHAR(500) NULL,
  `linkedin`        VARCHAR(500) NULL,
  `whatsapp`        VARCHAR(100) NULL,
  `tiktok`          VARCHAR(500) NULL,
  `telegram`        VARCHAR(500) NULL,
  `pinterest`       VARCHAR(500) NULL,

  -- Vendor / Login Info
  `name`            VARCHAR(255) NOT NULL,
  `profile`         VARCHAR(500) NULL,
  `address`         TEXT NULL,
  `contact`         VARCHAR(50)  NULL,
  `email`           VARCHAR(255) NOT NULL,
  `password`        VARCHAR(255) NOT NULL,
  `membership`      ENUM('basic','silver','gold','platinum') NOT NULL DEFAULT 'basic',
  `status`          ENUM('active','inactive') NOT NULL DEFAULT 'active',

  -- Bank Info
  `bank_name`       VARCHAR(255) NULL,
  `acc_no`          VARCHAR(100) NULL,
  `ifsc_code`       VARCHAR(50)  NULL,
  `acc_type`        ENUM('savings','current','overdraft') NULL,
  `branch`          VARCHAR(255) NULL,
  `bank_logo`                VARCHAR(500) NULL,
  `password_reset_token`     VARCHAR(10)  NULL,
  `password_reset_expires`   DATETIME     NULL,

  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `vendors_email_unique` (`email`),
  INDEX `vendors_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vendor Staff
CREATE TABLE IF NOT EXISTS `vendor_staff` (
  `id`                    INT          NOT NULL AUTO_INCREMENT,
  `vendor_id`             INT          NOT NULL,
  `role_id`               INT          DEFAULT NULL,
  `emp_id`                VARCHAR(50)  DEFAULT NULL,
  `name`                  VARCHAR(200) NOT NULL,
  `email`                 VARCHAR(255) NOT NULL,
  `mobile`                VARCHAR(20)  NOT NULL,
  `designation`           VARCHAR(200) DEFAULT NULL,
  `doj`                   DATE         DEFAULT NULL,
  `dor`                   DATE         DEFAULT NULL,
  `dob`                   DATE         DEFAULT NULL,
  `profile_pic`           LONGTEXT     DEFAULT NULL,
  `login_access`          BOOLEAN      DEFAULT 1,
  `is_active`             TINYINT      DEFAULT 1,
  `work_status`           ENUM('active', 'inactive', 'resigned', 'relieved') DEFAULT 'active',
  `address`               TEXT         DEFAULT NULL,
  `country`               VARCHAR(100) DEFAULT NULL,
  `state`                 VARCHAR(100) DEFAULT NULL,
  `district`              VARCHAR(100) DEFAULT NULL,
  `city`                  VARCHAR(100) DEFAULT NULL,
  `locality`              VARCHAR(100) DEFAULT NULL,
  `pincode`               VARCHAR(20)  DEFAULT NULL,
  `company_id`            INT          DEFAULT NULL,
  `password`              VARCHAR(255) DEFAULT NULL,
  `password_reset_token`  VARCHAR(10)  DEFAULT NULL,
  `password_reset_expires` DATETIME    DEFAULT NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`            DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vendor_staff_vendor` (`vendor_id`),
  KEY `idx_vendor_staff_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vendor Clients
CREATE TABLE IF NOT EXISTS `vendor_clients` (
  `id`                        INT          NOT NULL AUTO_INCREMENT,
  `vendor_id`                 INT          NOT NULL,
  `client_id`                 VARCHAR(50)  DEFAULT NULL,
  `name`                      VARCHAR(200) NOT NULL,
  `mobile`                    VARCHAR(20)  NOT NULL,
  `email`                     VARCHAR(255) NOT NULL,
  `profile_pic`               LONGTEXT     DEFAULT NULL,
  `registration_type`         ENUM('guest','client') DEFAULT 'client',
  `plan`                      ENUM('silver','gold','platinum','standard','not_subscribed') DEFAULT 'not_subscribed',
  `is_active`                 TINYINT      DEFAULT 1,
  `address`                   TEXT         DEFAULT NULL,
  `country`                   VARCHAR(100) DEFAULT NULL,
  `state`                     VARCHAR(100) DEFAULT NULL,
  `district`                  VARCHAR(100) DEFAULT NULL,
  `city`                      VARCHAR(100) DEFAULT NULL,
  `locality`                  VARCHAR(100) DEFAULT NULL,
  `pincode`                   VARCHAR(20)  DEFAULT NULL,
  `company_id`                INT          DEFAULT NULL,
  `login_access`              TINYINT(1)   DEFAULT 0,
  `send_credentials_to_email` TINYINT(1)   DEFAULT 0,
  `created_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`                DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Add new client columns if table already exists (for live DB upgrades)
ALTER TABLE `vendor_clients` ADD COLUMN IF NOT EXISTS `login_access`              TINYINT(1) DEFAULT 0;
ALTER TABLE `vendor_clients` ADD COLUMN IF NOT EXISTS `send_credentials_to_email` TINYINT(1) DEFAULT 0;

INSERT IGNORE INTO `modules` (`name`, `slug`, `description`, `company_id`, `is_active`) VALUES
('Vendors', 'vendors', 'Manage vendor accounts, company info and bank details', 1, 1);

INSERT IGNORE INTO `permissions` (`name`, `slug`, `module`, `company_id`, `description`, `is_active`) VALUES
('View Vendors',   'vendors.view',   'vendors', 1, 'View vendors list',        1),
('Create Vendors', 'vendors.create', 'vendors', 1, 'Create new vendor accounts', 1),
('Edit Vendors',   'vendors.edit',   'vendors', 1, 'Edit existing vendors',    1),
('Delete Vendors', 'vendors.delete', 'vendors', 1, 'Delete vendor accounts',   1);

UPDATE `permissions` p
JOIN `modules` m ON m.`slug` = p.`module`
SET p.`module_id` = m.`id`
WHERE p.`module` = 'vendors';

-- SuperAdmin (role 2) gets all vendor permissions without approval
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 2, p.id, 1, 0 FROM `permissions` p WHERE p.`module` = 'vendors';

-- Admin (role 3) gets view/delete freely; create/edit require approval
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 3, p.id, 1,
  CASE WHEN p.`slug` IN ('vendors.create', 'vendors.edit') THEN 1 ELSE 0 END
FROM `permissions` p WHERE p.`module` = 'vendors';

INSERT INTO `translation_keys` (`key`, `default_value`, `group`, `company_id`) VALUES
('nav.vendors',                'Vendors',                                                                       'nav',     1),
('vendors.title',              'Vendors',                                                                       'vendors', 1),
('vendors.desc',               'Manage vendor accounts, company info and bank details',                         'vendors', 1),
('vendors.add',                'Add Vendor',                                                                    'vendors', 1),
('vendors.search',             'Search vendors...',                                                             'vendors', 1),
('vendors.delete',             'Delete Vendor',                                                                 'vendors', 1),
('vendors.delete_confirm',     'Are you sure you want to delete this vendor? This action cannot be undone.',    'vendors', 1),
('vendors.no_vendors',         'No vendors found. Create your first vendor.',                                   'vendors', 1),
('vendors.company_info',       'Company Information',                                                           'vendors', 1),
('vendors.vendor_info',        'Vendor Information',                                                            'vendors', 1),
('vendors.bank_info',          'Bank Information',                                                              'vendors', 1),
('vendors.membership_basic',   'Basic',                                                                         'vendors', 1),
('vendors.membership_silver',  'Silver',                                                                        'vendors', 1),
('vendors.membership_gold',    'Gold',                                                                          'vendors', 1),
('vendors.membership_platinum','Platinum',                                                                      'vendors', 1),
('vendors.status_active',      'Active',                                                                        'vendors', 1),
('vendors.status_inactive',    'Inactive',                                                                      'vendors', 1),
('vendors.created',            'Vendor created successfully',                                                   'vendors', 1),
('vendors.updated',            'Vendor updated successfully',                                                   'vendors', 1),
('vendors.deleted',            'Vendor deleted successfully',                                                   'vendors', 1)
ON DUPLICATE KEY UPDATE `default_value` = VALUES(`default_value`), `group` = VALUES(`group`);

INSERT INTO `translations` (`translation_key_id`, `language_id`, `company_id`, `value`, `status`, `is_active`)
SELECT tk.id, 1, 1, tk.default_value, 'reviewed', 1
FROM `translation_keys` tk
WHERE tk.`group` = 'vendors' OR tk.`key` = 'nav.vendors'
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `status` = 'reviewed';

INSERT INTO `translation_keys` (`key`, `default_value`, `group`, `company_id`) VALUES
  ('common.close',          'Close',                          'common', 1),
  ('common.image',          'Image',                          'common', 1),
  ('common.slug',           'Slug',                           'common', 1),
  ('common.content',        'Content',                        'common', 1),
  ('common.sort_order',     'Sort Order',                     'common', 1),
  ('common.profile_image',  'Profile Image',                  'common', 1),
  ('common.uploading',      'Uploading...',                   'common', 1),
  ('common.processing',     'Processing...',                  'common', 1),
  ('common.upload_success', 'Image uploaded successfully',    'common', 1),
  ('common.upload_error',   'Failed to upload image',         'common', 1),
  ('common.preview',        'Preview',                        'common', 1),
  ('common.rename',         'Rename',                         'common', 1),
  ('common.crop',           'Crop',                           'common', 1),
  ('common.move',           'Move',                           'common', 1)
ON DUPLICATE KEY UPDATE `default_value` = VALUES(`default_value`), `group` = VALUES(`group`);

INSERT INTO `translations` (`translation_key_id`, `language_id`, `company_id`, `value`, `status`, `is_active`)
SELECT tk.id, 1, 1, tk.default_value, 'reviewed', 1
FROM `translation_keys` tk
WHERE tk.`key` IN (
  'common.close','common.image','common.slug','common.content','common.sort_order',
  'common.profile_image','common.uploading','common.processing',
  'common.upload_success','common.upload_error','common.preview',
  'common.rename','common.crop','common.move'
)
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `status` = 'reviewed';



INSERT INTO `translation_keys` (`key`, `default_value`, `group`, `company_id`) VALUES
  ('faq.title',                'FAQs',                                           'faq', 1),
  ('faq.desc',                 'Manage frequently asked questions and answers',  'faq', 1),
  ('faq.add_faq',              'Add FAQ',                                        'faq', 1),
  ('faq.no_faqs',              'No FAQs found.',                                 'faq', 1),
  ('faq.edit_faq',             'Edit FAQ',                                       'faq', 1),
  ('faq.create_faq',           'Create FAQ',                                     'faq', 1),
  ('faq.form_desc',            'Fill in the FAQ details.',                       'faq', 1),
  ('faq.question',             'Question',                                       'faq', 1),
  ('faq.answer',               'Answer',                                         'faq', 1),
  ('faq.category',             'Category',                                       'faq', 1),
  ('faq.sort_order',           'Sort Order',                                     'faq', 1),
  ('faq.name',                 'Name',                                           'faq', 1),
  ('faq.description',          'Description',                                    'faq', 1),
  ('faq.categories_title',     'FAQ Categories',                                 'faq', 1),
  ('faq.categories_desc',      'Manage categories for your FAQ section',         'faq', 1),
  ('faq.add_category',         'Add Category',                                   'faq', 1),
  ('faq.no_categories',        'No categories found.',                           'faq', 1),
  ('faq.category_name',        'Category Name',                                  'faq', 1),
  ('faq.edit_category',        'Edit Category',                                  'faq', 1),
  ('faq.create_category',      'Create Category',                                'faq', 1),
  ('faq.category_form_desc',   'Fill in the category details.',                  'faq', 1),
  ('faq.delete_category',      'Delete Category',                                'faq', 1),
  ('faq.delete_category_confirm','Are you sure you want to delete this FAQ category? This action cannot be undone.', 'faq', 1)
ON DUPLICATE KEY UPDATE `default_value` = VALUES(`default_value`), `group` = VALUES(`group`);

INSERT INTO `translations` (`translation_key_id`, `language_id`, `company_id`, `value`, `status`, `is_active`)
SELECT tk.id, 1, 1, tk.default_value, 'reviewed', 1
FROM `translation_keys` tk
WHERE tk.`group` = 'faq'
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `status` = 'reviewed';




INSERT INTO `translation_keys` (`key`, `default_value`, `group`, `company_id`) VALUES
  ('media.title',            'Media Library',                              'media', 1),
  ('media.upload',           'Upload',                                     'media', 1),
  ('media.uploading',        'Uploading...',                               'media', 1),
  ('media.size_limit',       'Max 10 MB per file',                         'media', 1),
  ('media.new_folder',       'New Folder',                                 'media', 1),
  ('media.search',           'Search...',                                  'media', 1),
  ('media.filter_all',       'All',                                        'media', 1),
  ('media.driver_label',     'Driver',                                     'media', 1),
  ('media.preview',          'Preview',                                    'media', 1),
  ('media.rename',           'Rename',                                     'media', 1),
  ('media.make_copy',        'Make a copy',                                'media', 1),
  ('media.copy_link',        'Copy Link',                                  'media', 1),
  ('media.crop',             'Crop',                                       'media', 1),
  ('media.move',             'Move',                                       'media', 1),
  ('media.delete',           'Delete',                                     'media', 1),
  ('media.no_results',       'No matching files',                          'media', 1),
  ('media.empty',            'This folder is empty',                       'media', 1),
  ('media.upload_first',     'Upload files',                               'media', 1),
  ('media.copied',           'Link copied!',                               'media', 1),
  ('media.new_folder_desc',  'Create a new folder in the current directory','media', 1),
  ('media.folder_name',      'Folder name',                                'media', 1),
  ('media.delete_confirm',   'This will permanently delete the selected file. This action cannot be undone.', 'media', 1),
  ('media.rename_desc',      'Enter a new name for the file',              'media', 1),
  ('media.new_name',         'New name',                                   'media', 1),
  ('media.select_destination','Select a destination folder',               'media', 1),
  ('media.move_to_root',     'Move to root folder',                        'media', 1),
  ('media.crop_success',     'Image cropped and replaced successfully',    'media', 1),
  ('media.crop_upload_error','Failed to upload cropped image',             'media', 1)
ON DUPLICATE KEY UPDATE `default_value` = VALUES(`default_value`), `group` = VALUES(`group`);

INSERT INTO `translations` (`translation_key_id`, `language_id`, `company_id`, `value`, `status`, `is_active`)
SELECT tk.id, 1, 1, tk.default_value, 'reviewed', 1
FROM `translation_keys` tk
WHERE tk.`group` = 'media'
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `status` = 'reviewed';




-- Approvals module removed — no permissions or functionality implemented

-- -----------------------------------------------------------------------------
-- 6. Companies module + permissions
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO `modules` (`name`, `slug`, `description`, `company_id`, `is_active`) VALUES
('Companies', 'companies', 'Company management (developer only)', 1, 1);

INSERT IGNORE INTO `permissions` (`name`, `slug`, `module`, `company_id`, `description`, `is_active`) VALUES
('View Companies',  'companies.view',   'companies', 1, 'View companies list', 1),
('Create Company',  'companies.create', 'companies', 1, 'Create companies',    1),
('Edit Company',    'companies.edit',   'companies', 1, 'Edit companies',      1),
('Delete Company',  'companies.delete', 'companies', 1, 'Delete companies',    1);

-- Companies are developer-only in the UI; assign SuperAdmin for backend access
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 2, p.id, 1, 0 FROM `permissions` p WHERE p.`module` = 'companies';

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 3, p.id, 1,
  CASE WHEN p.`slug` IN ('companies.create','companies.edit','companies.delete') THEN 1 ELSE 0 END
FROM `permissions` p WHERE p.`module` = 'companies';

CREATE TABLE IF NOT EXISTS `menus` (
  `id`                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                     VARCHAR(255) NOT NULL,
  `icon`                     VARCHAR(100) NULL DEFAULT '',
  `icon_fill_color_light`    VARCHAR(20)  NULL DEFAULT NULL,
  `icon_fill_color_dark`     VARCHAR(20)  NULL DEFAULT NULL,
  `sort_order`               INT          NOT NULL DEFAULT 0,
  `is_active`                TINYINT      NOT NULL DEFAULT 1 COMMENT '0=inactive, 1=active',
  `display_status`           TINYINT      NOT NULL DEFAULT 1 COMMENT '0=hidden, 1=visible',
  `company_id`               INT UNSIGNED NULL DEFAULT NULL,
  `created_by`               INT UNSIGNED NULL DEFAULT NULL,
  `updated_by`               INT UNSIGNED NULL DEFAULT NULL,
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`               DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_menus_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `modules` (`name`, `slug`, `description`, `company_id`, `is_active`) VALUES
('Menus', 'menus', 'Manage menu items', 1, 1);

INSERT IGNORE INTO `permissions` (`name`, `slug`, `module`, `company_id`, `description`, `is_active`) VALUES
('View Menus',   'menus.view',   'menus', 1, 'View menus list',       1),
('Create Menus', 'menus.create', 'menus', 1, 'Create new menus',      1),
('Edit Menus',   'menus.edit',   'menus', 1, 'Edit existing menus',   1),
('Delete Menus', 'menus.delete', 'menus', 1, 'Delete menus',          1);

UPDATE `permissions` p
JOIN `modules` m ON m.`slug` = p.`module`
SET p.`module_id` = m.`id`
WHERE p.`module` = 'menus';

-- SuperAdmin (role 2) gets all menus permissions without approval
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 2, p.id, 1, 0 FROM `permissions` p WHERE p.`module` = 'menus';

-- Admin (role 3) gets view freely; create/edit/delete require approval
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 3, p.id, 1,
  CASE WHEN p.`slug` IN ('menus.create', 'menus.edit', 'menus.delete') THEN 1 ELSE 0 END
FROM `permissions` p WHERE p.`module` = 'menus';



CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id`          INT            NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(200)   NOT NULL,
  `description` TEXT           DEFAULT NULL,
  `menu_ids`    JSON           DEFAULT NULL COMMENT 'Array of menu IDs',
  `price`       DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
  `validity`    INT            DEFAULT NULL COMMENT 'Days, NULL = no expiry',
  `features`    LONGTEXT       DEFAULT NULL COMMENT 'Rich HTML content',
  `sort_order`  INT            NOT NULL DEFAULT 0,
  `is_active`   TINYINT        NOT NULL DEFAULT 1 COMMENT '0=inactive,1=active',
  `is_custom`   TINYINT(1)     NOT NULL DEFAULT 0 COMMENT '1=custom plan for specific vendor',
  `vendor_id`   INT UNSIGNED   DEFAULT NULL COMMENT 'FK to vendors.id (only when is_custom=1)',
  `discounted_price` DECIMAL(10,2) DEFAULT NULL COMMENT 'Price after discount',
  `company_id`  INT            DEFAULT NULL,
  `created_by`  INT            DEFAULT NULL,
  `updated_by`  INT            DEFAULT NULL,
  `created_at`  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME       DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_subscriptions_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `modules` (`name`, `slug`, `description`, `company_id`, `is_active`) VALUES
('Subscriptions', 'subscriptions', 'Manage subscription plans', 1, 1);

INSERT IGNORE INTO `permissions` (`name`, `slug`, `module`, `company_id`, `description`, `is_active`) VALUES
('View Subscriptions',   'subscriptions.view',   'subscriptions', 1, 'View subscription plans list', 1),
('Create Subscriptions', 'subscriptions.create', 'subscriptions', 1, 'Create new subscription plans', 1),
('Edit Subscriptions',   'subscriptions.edit',   'subscriptions', 1, 'Edit existing subscription plans', 1),
('Delete Subscriptions', 'subscriptions.delete', 'subscriptions', 1, 'Delete subscription plans', 1);

UPDATE `permissions` p
JOIN `modules` m ON m.`slug` = p.`module`
SET p.`module_id` = m.`id`
WHERE p.`module` = 'subscriptions';

-- SuperAdmin (role 2) gets all subscriptions permissions without approval
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 2, p.id, 1, 0 FROM `permissions` p WHERE p.`module` = 'subscriptions';

-- Admin (role 3) gets view freely; create/edit/delete require approval
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`, `company_id`, `requires_approval`)
SELECT 3, p.id, 1,
  CASE WHEN p.`slug` IN ('subscriptions.create', 'subscriptions.edit', 'subscriptions.delete') THEN 1 ELSE 0 END
FROM `permissions` p WHERE p.`module` = 'subscriptions';

INSERT INTO `translation_keys` (`key`, `default_value`, `group`, `company_id`) VALUES
('nav.subscriptions',                'Subscriptions',                                         'nav',           1),
('subscriptions.title',              'Subscriptions',                                         'subscriptions', 1),
('subscriptions.desc',               'Manage subscription plans',                             'subscriptions', 1),
('subscriptions.add',                'Add Subscription',                                      'subscriptions', 1),
('subscriptions.edit',               'Edit Subscription',                                     'subscriptions', 1),
('subscriptions.form_desc',          'Fill in the subscription plan details.',                'subscriptions', 1),
('subscriptions.name',               'Plan Name',                                             'subscriptions', 1),
('subscriptions.description',        'Description',                                           'subscriptions', 1),
('subscriptions.menus',              'Menus',                                                 'subscriptions', 1),
('subscriptions.price',              'Price',                                                 'subscriptions', 1),
('subscriptions.validity',           'Validity (days)',                                       'subscriptions', 1),
('subscriptions.validity_hint',      'Leave 0 for no expiry',                                 'subscriptions', 1),
('subscriptions.features',           'Features',                                              'subscriptions', 1),
('subscriptions.sort_order',         'Sort Order',                                            'subscriptions', 1),
('subscriptions.sort_order_hint',    'Lower number = higher in list',                         'subscriptions', 1),
('subscriptions.is_active',          'Active Status',                                         'subscriptions', 1),
('subscriptions.no_records',         'No subscriptions found. Create your first plan.',       'subscriptions', 1),
('subscriptions.delete',             'Delete Subscription',                                   'subscriptions', 1),
('subscriptions.delete_confirm',     'Are you sure you want to delete this subscription plan? This action cannot be undone.', 'subscriptions', 1),
('subscriptions.created',            'Subscription created successfully',                     'subscriptions', 1),
('subscriptions.updated',            'Subscription updated successfully',                     'subscriptions', 1),
('subscriptions.deleted',            'Subscription deleted successfully',                     'subscriptions', 1),
('subscriptions.not_found',          'Subscription not found',                                'subscriptions', 1)
ON DUPLICATE KEY UPDATE `default_value` = VALUES(`default_value`), `group` = VALUES(`group`);

INSERT INTO `translations` (`translation_key_id`, `language_id`, `company_id`, `value`, `status`, `is_active`)
SELECT tk.id, 1, 1, tk.default_value, 'reviewed', 1
FROM `translation_keys` tk
WHERE tk.`group` = 'subscriptions' OR tk.`key` = 'nav.subscriptions'
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `status` = 'reviewed';

-- ============================================================
-- Menus translation keys
-- ============================================================
INSERT INTO `translation_keys` (`key`, `default_value`, `group`, `company_id`) VALUES
  ('nav.menus',                   'Menus',                                                                      'nav',   1),
  ('nav.events',                  'Events',                                                                     'nav',   1),
  ('nav.reports',                 'Report Management',                                                          'nav',   1),
  ('nav.marketing',               'Marketing',                                                                  'nav',   1),
  ('nav.communication',           'Communication',                                                              'nav',   1),
  ('nav.notifications',           'Notifications',                                                              'nav',   1),
  ('nav.mail',                    'Mail',                                                                       'nav',   1),
  ('nav.support',                 'Support',                                                                    'nav',   1),
  ('menus.title',                 'Menus',                                                                      'menus', 1),
  ('menus.desc',                  'Manage menu items',                                                          'menus', 1),
  ('menus.add',                   'Add Menu',                                                                   'menus', 1),
  ('menus.edit',                  'Edit Menu',                                                                  'menus', 1),
  ('menus.form_desc',             'Fill in the menu item details.',                                             'menus', 1),
  ('menus.name',                  'Menu Name',                                                                  'menus', 1),
  ('menus.icon',                  'Icon',                                                                       'menus', 1),
  ('menus.icon_fill_color_light', 'Icon Color (Light)',                                                         'menus', 1),
  ('menus.icon_fill_color_dark',  'Icon Color (Dark)',                                                          'menus', 1),
  ('menus.sort_order',            'Sort Order',                                                                 'menus', 1),
  ('menus.display_status',        'Display Status',                                                             'menus', 1),
  ('menus.no_records',            'No menus found. Create your first menu.',                                    'menus', 1),
  ('menus.delete',                'Delete Menu',                                                                'menus', 1),
  ('menus.delete_confirm',        'Are you sure you want to delete this menu? This action cannot be undone.',   'menus', 1)
ON DUPLICATE KEY UPDATE `default_value` = VALUES(`default_value`), `group` = VALUES(`group`);

INSERT INTO `translations` (`translation_key_id`, `language_id`, `company_id`, `value`, `status`, `is_active`)
SELECT tk.id, 1, 1, tk.default_value, 'reviewed', 1
FROM `translation_keys` tk
WHERE tk.`group` = 'menus'
   OR tk.`key` IN ('nav.menus','nav.events','nav.reports','nav.marketing','nav.communication','nav.notifications','nav.mail','nav.support')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `status` = 'reviewed';

-- ═══════════════════════════════════════════════════════════════
-- Vendor RBAC — Init
-- ═══════════════════════════════════════════════════════════════

-- STEP 1: Add new columns
ALTER TABLE vendor_staff ADD COLUMN IF NOT EXISTS role_id INT NULL AFTER vendor_id;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS vendor_id INT NULL AFTER company_id;
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS vendor_id INT NULL AFTER company_id;
ALTER TABLE modules ADD COLUMN IF NOT EXISTS vendor_id INT NULL AFTER company_id;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS vendor_id INT NULL AFTER company_id;

-- STEP 2: Remove known orphaned permission records (IDs 71-76 from old seeder run — safe: 0 rows on clean DB)
DELETE FROM permissions WHERE id BETWEEN 71 AND 76;

-- STEP 2b: Rename admin modules/permissions that share slugs with vendor RBAC (safe: WHERE company_id=1 guards admin-only rows)
UPDATE modules     SET slug='admin_roles',        name='Admin Roles'    WHERE slug='roles'         AND company_id=1;
UPDATE modules     SET slug='admin_modules',      name='Admin Modules'  WHERE slug='modules'       AND company_id=1;
UPDATE modules     SET slug='admin_settings',     name='Admin Settings' WHERE slug='settings'      AND company_id=1;
UPDATE permissions SET slug='admin_roles.view'    WHERE slug='roles.view'    AND company_id=1;
UPDATE permissions SET slug='admin_modules.view'  WHERE slug='modules.view'  AND company_id=1;
UPDATE permissions SET slug='admin_settings.view' WHERE slug='settings.view' AND company_id=1;
UPDATE permissions SET slug='admin_settings.edit' WHERE slug='settings.edit' AND company_id=1;

-- STEP 3: Insert vendor portal modules
INSERT IGNORE INTO modules (name, slug, description, company_id, vendor_id, is_active, created_at, updated_at) VALUES
('Dashboard',           'dashboard',            'Dashboard and analytics',          NULL, NULL, 1, NOW(), NOW()),
('Client',              'client',               'Client management',                NULL, NULL, 1, NOW(), NOW()),
('Staff',               'staff',                'Staff management',                 NULL, NULL, 1, NOW(), NOW()),
('Roles',               'roles',                'Role management',                  NULL, NULL, 1, NOW(), NOW()),
('Modules',             'modules',              'Module management',                NULL, NULL, 1, NOW(), NOW()),
('Communication',       'communication',        'Contact, email and chat',          NULL, NULL, 1, NOW(), NOW()),
('Reports',             'reports',              'Reports and analytics',            NULL, NULL, 1, NOW(), NOW()),
('Transactions',        'transactions',         'Transaction management',           NULL, NULL, 1, NOW(), NOW()),
('Event',               'event',                'Event management',                 NULL, NULL, 1, NOW(), NOW()),
('Payment',             'payment',              'Payment management',               NULL, NULL, 1, NOW(), NOW()),
('Settings',            'settings',             'Payment settings, configuration, currency, timezone, activity log', NULL, NULL, 1, NOW(), NOW()),
('Help',                'help',                 'Help and support',                 NULL, NULL, 1, NOW(), NOW()),
('Website Management',  'website_management',   'Website management',               NULL, NULL, 1, NOW(), NOW());

-- STEP 4: Insert permissions for each module
INSERT IGNORE INTO permissions (name, slug, module_id, module, description, company_id, vendor_id, is_active, created_at, updated_at) VALUES
-- Dashboard
('View Dashboard',        'dashboard.view',          (SELECT id FROM modules WHERE slug='dashboard' LIMIT 1),          'dashboard',          'View dashboard',              NULL, NULL, 1, NOW(), NOW()),
-- Client
('View Client',           'client.view',             (SELECT id FROM modules WHERE slug='client' LIMIT 1),             'client',             'View clients',                NULL, NULL, 1, NOW(), NOW()),
('Create Client',         'client.create',           (SELECT id FROM modules WHERE slug='client' LIMIT 1),             'client',             'Create clients',              NULL, NULL, 1, NOW(), NOW()),
('Edit Client',           'client.edit',             (SELECT id FROM modules WHERE slug='client' LIMIT 1),             'client',             'Edit clients',                NULL, NULL, 1, NOW(), NOW()),
('Delete Client',         'client.delete',           (SELECT id FROM modules WHERE slug='client' LIMIT 1),             'client',             'Delete clients',              NULL, NULL, 1, NOW(), NOW()),
-- Staff
('View Staff',            'staff.view',              (SELECT id FROM modules WHERE slug='staff' LIMIT 1),              'staff',              'View staff',                  NULL, NULL, 1, NOW(), NOW()),
('Create Staff',          'staff.create',            (SELECT id FROM modules WHERE slug='staff' LIMIT 1),              'staff',              'Create staff',                NULL, NULL, 1, NOW(), NOW()),
('Edit Staff',            'staff.edit',              (SELECT id FROM modules WHERE slug='staff' LIMIT 1),              'staff',              'Edit staff',                  NULL, NULL, 1, NOW(), NOW()),
('Delete Staff',          'staff.delete',            (SELECT id FROM modules WHERE slug='staff' LIMIT 1),              'staff',              'Delete staff',                NULL, NULL, 1, NOW(), NOW()),
-- Roles
('View Roles',            'roles.view',              (SELECT id FROM modules WHERE slug='roles' LIMIT 1),              'roles',              'View roles',                  NULL, NULL, 1, NOW(), NOW()),
('Create Roles',          'roles.create',            (SELECT id FROM modules WHERE slug='roles' LIMIT 1),              'roles',              'Create roles',                NULL, NULL, 1, NOW(), NOW()),
('Edit Roles',            'roles.edit',              (SELECT id FROM modules WHERE slug='roles' LIMIT 1),              'roles',              'Edit roles',                  NULL, NULL, 1, NOW(), NOW()),
('Delete Roles',          'roles.delete',            (SELECT id FROM modules WHERE slug='roles' LIMIT 1),              'roles',              'Delete roles',                NULL, NULL, 1, NOW(), NOW()),
-- Modules
('View Modules',          'modules.view',            (SELECT id FROM modules WHERE slug='modules' LIMIT 1),            'modules',            'View modules',                NULL, NULL, 1, NOW(), NOW()),
-- Communication
('View Communication',    'communication.view',      (SELECT id FROM modules WHERE slug='communication' LIMIT 1),      'communication',      'View communication',          NULL, NULL, 1, NOW(), NOW()),
('Send Communication',    'communication.send',      (SELECT id FROM modules WHERE slug='communication' LIMIT 1),      'communication',      'Send messages and emails',    NULL, NULL, 1, NOW(), NOW()),
-- Reports
('View Reports',          'reports.view',            (SELECT id FROM modules WHERE slug='reports' LIMIT 1),            'reports',            'View reports',                NULL, NULL, 1, NOW(), NOW()),
-- Transactions
('View Transactions',     'transactions.view',       (SELECT id FROM modules WHERE slug='transactions' LIMIT 1),       'transactions',       'View transactions',           NULL, NULL, 1, NOW(), NOW()),
-- Event
('View Event',            'event.view',              (SELECT id FROM modules WHERE slug='event' LIMIT 1),              'event',              'View events',                 NULL, NULL, 1, NOW(), NOW()),
('Create Event',          'event.create',            (SELECT id FROM modules WHERE slug='event' LIMIT 1),              'event',              'Create events',               NULL, NULL, 1, NOW(), NOW()),
('Edit Event',            'event.edit',              (SELECT id FROM modules WHERE slug='event' LIMIT 1),              'event',              'Edit events',                 NULL, NULL, 1, NOW(), NOW()),
('Delete Event',          'event.delete',            (SELECT id FROM modules WHERE slug='event' LIMIT 1),              'event',              'Delete events',               NULL, NULL, 1, NOW(), NOW()),
-- Payment
('View Payment',          'payment.view',            (SELECT id FROM modules WHERE slug='payment' LIMIT 1),            'payment',            'View payments',               NULL, NULL, 1, NOW(), NOW()),
('Edit Payment',          'payment.edit',            (SELECT id FROM modules WHERE slug='payment' LIMIT 1),            'payment',            'Edit payments',               NULL, NULL, 1, NOW(), NOW()),
-- Settings
('View Settings',         'settings.view',           (SELECT id FROM modules WHERE slug='settings' LIMIT 1),           'settings',           'View settings',               NULL, NULL, 1, NOW(), NOW()),
('Edit Settings',         'settings.edit',           (SELECT id FROM modules WHERE slug='settings' LIMIT 1),           'settings',           'Edit settings',               NULL, NULL, 1, NOW(), NOW()),
-- Help
('View Help',             'help.view',               (SELECT id FROM modules WHERE slug='help' LIMIT 1),               'help',               'View help',                   NULL, NULL, 1, NOW(), NOW()),
-- Website Management
('View Website',          'website_management.view', (SELECT id FROM modules WHERE slug='website_management' LIMIT 1), 'website_management', 'View website management',     NULL, NULL, 1, NOW(), NOW()),
('Edit Website',          'website_management.edit', (SELECT id FROM modules WHERE slug='website_management' LIMIT 1), 'website_management', 'Edit website management',     NULL, NULL, 1, NOW(), NOW());
