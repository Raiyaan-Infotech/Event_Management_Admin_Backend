-- "Contact Us" event menu renamed to "Contact Person" (Jamal, 2026-10-26).
-- Name only; the slug `contact-us` stays, so the app / portal routing is unchanged.
-- Re-runnable: a row already renamed is not touched.
UPDATE event_menus
   SET name = 'Contact Person', updated_at = NOW()
 WHERE slug = 'contact-us' AND name = 'Contact Us';
