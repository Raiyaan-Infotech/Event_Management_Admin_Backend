-- Remove "Eggetarian", "Kids Meal" and "Other" from the guest food preference
-- lists (every category, plus the no-category fallback). Jamal, 2026-10-14.
-- Soft delete (deleted_at), the same as the admin's Delete button, so a guest
-- who already picked one keeps their saved answer and the row can be restored.
-- guest-options.seeder.js no longer lists them, so a re-run will not add them back.
-- Run against local + live DBs. Safe to re-run.

-- 1. What will be removed, and whether anyone uses it
SELECT o.id, o.event_category_id, o.name,
       (SELECT COUNT(*) FROM guests g WHERE g.food_preference_option_id = o.id) AS guests_using,
       (SELECT COUNT(*) FROM event_participants p WHERE p.food_preference_option_id = o.id) AS participants_using
FROM guest_food_preference_options o
WHERE o.deleted_at IS NULL
  AND LOWER(TRIM(o.name)) IN ('eggetarian', 'kids meal', 'other');

-- 2. Remove them
UPDATE guest_food_preference_options
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND LOWER(TRIM(name)) IN ('eggetarian', 'kids meal', 'other');

-- 3. Check: should return 0
SELECT COUNT(*) AS still_listed
FROM guest_food_preference_options
WHERE deleted_at IS NULL
  AND LOWER(TRIM(name)) IN ('eggetarian', 'kids meal', 'other');
