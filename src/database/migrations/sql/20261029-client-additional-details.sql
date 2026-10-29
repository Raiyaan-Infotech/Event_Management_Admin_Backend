-- Participant Edit Profile -> Additional Details (Jamal, 2026-10-29): a cover
-- image and the four fixed social links on the ACCOUNT.
-- social_links: {"whatsapp":"+91 ...","instagram":"https://...","facebook":"https://...","x":"https://..."}
-- Applied by src/database/tools/apply-client-personal-address.js.
ALTER TABLE `website_clients`
  ADD COLUMN `cover_image_url` VARCHAR(500) NULL AFTER `avatar_url`,
  ADD COLUMN `social_links` JSON NULL AFTER `visible_fields`;
