-- Contact person boundaries (Jamal, 2026-10-26): the owner chooses which of an
-- event's ADDITIONAL menus its contact person (the organizer login,
-- organizer_client_id) may see and use. JSON list of event_menus ids;
-- NULL = every additional menu (no limit). Default menus are always allowed.
-- Participants are not affected.
ALTER TABLE events ADD COLUMN contact_menu_ids JSON NULL AFTER contact_about;
