-- Contact person = the EVENT's contact (Jamal, 2026-10-26): one event has one
-- contact person, kept on the event row (organizer, contact_phone, contact_*).
-- They are NOT clients: no website_clients row. Signing in is by the event's
-- contact mobile; this table only holds the sign-in code for that number.
CREATE TABLE IF NOT EXISTS contact_person_logins (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    vendor_id INT UNSIGNED NOT NULL,
    mobile VARCHAR(20) NOT NULL COMMENT 'national number, last 10 digits',
    otp_hash VARCHAR(255) NULL,
    otp_expires_at DATETIME NULL,
    otp_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_contact_person_login (vendor_id, mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
