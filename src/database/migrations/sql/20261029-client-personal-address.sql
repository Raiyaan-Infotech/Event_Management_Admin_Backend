-- Participant Edit Profile (Jamal, 2026-10-29): personal + address details on
-- the ACCOUNT (website_clients). All nullable; nothing reads them but the
-- profile screens. Applied by src/database/tools/apply-client-personal-address.js.
ALTER TABLE `website_clients`
  ADD COLUMN `date_of_birth` DATE NULL AFTER `bio`,
  ADD COLUMN `gender` ENUM('male','female','other') NULL AFTER `date_of_birth`,
  ADD COLUMN `profession` VARCHAR(100) NULL AFTER `gender`,
  ADD COLUMN `country` VARCHAR(100) NULL AFTER `profession`,
  ADD COLUMN `state` VARCHAR(100) NULL AFTER `country`,
  ADD COLUMN `city` VARCHAR(100) NULL AFTER `state`,
  ADD COLUMN `postal_code` VARCHAR(20) NULL AFTER `city`,
  ADD COLUMN `address` VARCHAR(500) NULL AFTER `postal_code`;
