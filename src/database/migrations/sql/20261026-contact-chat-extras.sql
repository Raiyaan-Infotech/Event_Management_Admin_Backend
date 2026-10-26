-- Contact Person chat, round 2 (Jamal's designs, 2026-10-26):
--  * Remove Participant  → status 'removed' (gone from Participant Chats; a new
--    message from them brings the chat back).
--  * Offline auto reply  → messages flagged is_auto.
--  * Online / Offline    → "active in the app in the last few minutes", kept
--    per mobile number in contact_person_logins.last_seen_at (no client row
--    needed — a contact person has none).
ALTER TABLE event_contact_chats
    MODIFY status ENUM('open','resolved','blocked','removed') NOT NULL DEFAULT 'open';
ALTER TABLE event_contact_chat_messages
    ADD COLUMN is_auto TINYINT(1) NOT NULL DEFAULT 0 AFTER body;
ALTER TABLE contact_person_logins
    ADD COLUMN last_seen_at DATETIME NULL AFTER last_login_at;
