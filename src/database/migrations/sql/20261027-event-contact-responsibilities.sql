-- Add Responsibility flow (Jamal, 2026-10-27): the owner switches on which of
-- the event category's Responsibilities (event_responsibilities) the contact
-- person handles; only those show on the Contact Person profile.
-- JSON list of event_responsibilities ids; NULL = all of them (as before).
ALTER TABLE events ADD COLUMN contact_responsibility_ids JSON NULL AFTER contact_menu_ids;
