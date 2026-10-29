-- Participant Edit Profile → Public Visibility (Jamal, 2026-10-29).
-- profile_visibility: 'everyone' = other participants of a shared event see the
-- profile (as visible_fields allows); 'private' = only the host / contact person.
-- visible_fields: {"photo":bool,"name":bool,"contact":bool}; NULL = all shown.
-- Applied by src/database/tools/apply-client-personal-address.js.
ALTER TABLE `website_clients`
  ADD COLUMN `profile_visibility` ENUM('everyone','private') NOT NULL DEFAULT 'everyone' AFTER `address`,
  ADD COLUMN `visible_fields` JSON NULL AFTER `profile_visibility`;
