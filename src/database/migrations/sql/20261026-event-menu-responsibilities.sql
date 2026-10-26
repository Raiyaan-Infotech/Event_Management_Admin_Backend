-- Contact Person responsibilities, managed in the admin portal's Menu module
-- (Jamal, 2026-10-26). A JSON list of names on the menu row; only the
-- Contact Person menu (slug contact-us) uses it. Seeded with the six the app
-- showed hardcoded until now.
ALTER TABLE event_menus ADD COLUMN responsibilities JSON NULL AFTER remarks;
UPDATE event_menus
   SET responsibilities = JSON_ARRAY('Guest Help Desk', 'Venue Guidance', 'RSVP Support',
                                     'Timing Coordination', 'Family Assistance', 'Emergency Support')
 WHERE slug = 'contact-us' AND responsibilities IS NULL;
