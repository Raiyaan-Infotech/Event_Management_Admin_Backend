-- Contact Person Profile (Jamal's design, 2026-10-26): the event's contact
-- person gets its OWN fields. Before this, the app's contact "Address" was
-- written to venue_address and its "Description" to the event description.
-- Name / photo / mobile / email stay in organizer, organizer_image,
-- contact_phone, contact_email. Responsibilities are fixed in the app (not stored).
ALTER TABLE events ADD COLUMN contact_designation VARCHAR(100) NULL AFTER contact_email;
ALTER TABLE events ADD COLUMN contact_whatsapp VARCHAR(30) NULL AFTER contact_designation;
ALTER TABLE events ADD COLUMN contact_address VARCHAR(500) NULL AFTER contact_whatsapp;
ALTER TABLE events ADD COLUMN contact_time_from VARCHAR(5) NULL COMMENT 'HH:MM, 24h' AFTER contact_address;
ALTER TABLE events ADD COLUMN contact_time_to VARCHAR(5) NULL COMMENT 'HH:MM, 24h' AFTER contact_time_from;
ALTER TABLE events ADD COLUMN contact_languages JSON NULL COMMENT '["Tamil","English"]' AFTER contact_time_to;
ALTER TABLE events ADD COLUMN contact_about VARCHAR(300) NULL AFTER contact_languages;
