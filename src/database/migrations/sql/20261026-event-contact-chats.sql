-- Contact Person chat (Jamal, 2026-10-26): a participant's one-to-one chat with
-- the event team (the owner and the event's contact person). One chat per
-- (event, participant client). Status: open / resolved / blocked (blocked =
-- that participant cannot send in THIS event's chat).
CREATE TABLE IF NOT EXISTS event_contact_chats (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id INT UNSIGNED NOT NULL,
    participant_client_id INT UNSIGNED NOT NULL,
    status ENUM('open','resolved','blocked') NOT NULL DEFAULT 'open',
    last_message VARCHAR(255) NULL,
    last_message_at DATETIME NULL,
    team_unread INT UNSIGNED NOT NULL DEFAULT 0,
    participant_unread INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_contact_chat (event_id, participant_client_id),
    KEY idx_contact_chat_event (event_id, last_message_at),
    CONSTRAINT fk_contact_chat_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS event_contact_chat_messages (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    chat_id INT UNSIGNED NOT NULL,
    sender_side ENUM('participant','team') NOT NULL,
    sender_client_id INT UNSIGNED NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_contact_chat_msg (chat_id, id),
    CONSTRAINT fk_contact_chat_msg_chat FOREIGN KEY (chat_id) REFERENCES event_contact_chats (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
