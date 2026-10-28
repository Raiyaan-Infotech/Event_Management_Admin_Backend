-- Personal QR codes (Jamal, 2026-10-28): one per person — each account
-- (host or participant; a participant's QR is their account's, the same in
-- every event) and each contact person. See src/utils/personQr.js. Applied
-- by src/database/tools/apply-person-qr.js, which also fills a code for every
-- existing row. One statement per table.

ALTER TABLE `website_clients`
  ADD COLUMN `qr_code` char(32) DEFAULT NULL COMMENT 'Personal QR lookup key (utils/personQr.js)',
  ADD COLUMN `qr_token` varchar(255) DEFAULT NULL COMMENT 'Encrypted string drawn as the QR',
  ADD UNIQUE KEY `uq_website_clients_qr_code` (`qr_code`);

ALTER TABLE `contact_person_logins`
  ADD COLUMN `qr_code` char(32) DEFAULT NULL COMMENT 'Personal QR lookup key (utils/personQr.js)',
  ADD COLUMN `qr_token` varchar(255) DEFAULT NULL COMMENT 'Encrypted string drawn as the QR',
  ADD UNIQUE KEY `uq_contact_person_logins_qr_code` (`qr_code`);
