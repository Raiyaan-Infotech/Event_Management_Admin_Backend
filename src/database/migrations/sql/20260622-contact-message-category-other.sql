-- Store the free-text "Please specify" value when a contact form visitor picks
-- the "Other" category. Run against local + live `event_` DBs.
-- (MySQL 8 does not support ADD COLUMN IF NOT EXISTS; run once.)
ALTER TABLE `vendor_website_contact_messages`
  ADD COLUMN `category_other` VARCHAR(190) DEFAULT NULL AFTER `category_id`;
