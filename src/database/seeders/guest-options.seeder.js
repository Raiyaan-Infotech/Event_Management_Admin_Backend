#!/usr/bin/env node
/**
 * The guest registration dropdowns, per event category.
 *
 *   event_categories                 the 13 categories the supplied lists need
 *   guest_relationship_options       "Relationship with Invitor"
 *   guest_food_preference_options    "Food Preference"
 *
 * ── RE-RUNNABLE, AND IT DOES NOT TRAMPLE ADMIN EDITS ────────────────────────
 * A plain run only ADDS what is missing: a category is matched by name and a
 * value by (category, name), and anything already there is left exactly as it
 * is. That matters because these rows are admin-editable — somebody may have
 * renamed a value, reordered the list or switched one off, and a seeder that
 * "restores" the original list would quietly undo their work every time it ran.
 *
 * `--clear` is the deliberate opposite: it hard-deletes every option row and
 * rebuilds from this file. It never touches the categories, because events
 * point at those and deleting one would cascade.
 *
 * ── WHY THE CATEGORIES ARE SEEDED HERE TOO ──────────────────────────────────
 * The supplied lists are keyed by category, and only 4 of the 17 existed
 * (Wedding, Corporate, Birthday, Anniversary). The other 13 are created here,
 * because a foreign key cannot point at a category that does not exist — and
 * seeding the values without them would silently drop three quarters of the
 * data.
 *
 * ── THE NULL-CATEGORY FALLBACK ──────────────────────────────────────────────
 * `events.event_category_id` is nullable, and the existing "Other" category has
 * no list of its own in the supplied data. Both fall back to the rows seeded
 * with `event_category_id = NULL`, so the form always has something to show.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/seeders/guest-options.seeder.js
 *   node src/database/seeders/guest-options.seeder.js --clear
 */

require('dotenv').config();
const path = require('path');

const args = process.argv.slice(2);
const CLEAR = args.includes('--clear');
const PROD = args.includes('--prod') || args.includes('prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const {
    sequelize,
    EventCategory,
    GuestRelationshipOption,
    GuestFoodPreferenceOption,
} = require('../../models');

/** Every list here belongs to company 1, matching the categories already seeded. */
const COMPANY_ID = 1;

/**
 * Categories the supplied lists need.
 *
 * `existing: true` means a row is already in the database under that exact name
 * and must be REUSED, not duplicated — events already point at those ids.
 */
const CATEGORIES = [
    { key: 'wedding', name: 'Wedding', existing: true },
    { key: 'corporate', name: 'Corporate', existing: true },
    { key: 'birthday', name: 'Birthday', existing: true },
    { key: 'anniversary', name: 'Anniversary', existing: true },

    { key: 'engagement', name: 'Engagement', icon: 'mdi:ring', color: '#A855F7', sort_order: 6 },
    { key: 'baby_shower', name: 'Baby Shower', icon: 'mdi:baby-carriage', color: '#F472B6', sort_order: 7 },
    { key: 'housewarming', name: 'Housewarming', icon: 'mdi:home-heart', color: '#10B981', sort_order: 8 },
    { key: 'graduation', name: 'Graduation', icon: 'mdi:school', color: '#6366F1', sort_order: 9 },
    { key: 'conference', name: 'Conference', icon: 'mdi:presentation', color: '#0EA5E9', sort_order: 10 },
    { key: 'festival', name: 'Festival', icon: 'mdi:party-popper', color: '#F97316', sort_order: 11 },
    { key: 'religious', name: 'Religious', icon: 'mdi:temple-hindu', color: '#EAB308', sort_order: 12 },
    { key: 'sports', name: 'Sports', icon: 'mdi:trophy', color: '#22C55E', sort_order: 13 },
    { key: 'school_college', name: 'School & College', icon: 'mdi:book-open-variant', color: '#8B5CF6', sort_order: 14 },
    { key: 'concert', name: 'Concert', icon: 'mdi:music', color: '#D946EF', sort_order: 15 },
    { key: 'memorial', name: 'Memorial', icon: 'mdi:candle', color: '#64748B', sort_order: 16 },
    { key: 'social', name: 'Social & Community', icon: 'mdi:handshake', color: '#14B8A6', sort_order: 17 },
    { key: 'exhibition', name: 'Exhibition', icon: 'mdi:storefront', color: '#F43F5E', sort_order: 18 },
];

/** `null` is the fallback list — see the header. */
const RELATIONSHIPS = {
    null: ["Family", "Relative", "Friend", "Family Friend", "Colleague", "Neighbor", "Other"],

    wedding: [
        "Bride's Father", "Bride's Mother", "Bride's Brother", "Bride's Sister",
        "Bride's Relative", "Bride's Friend",
        "Groom's Father", "Groom's Mother", "Groom's Brother", "Groom's Sister",
        "Groom's Relative", "Groom's Friend",
        "Family Friend", "Colleague", "Neighbor", "Other",
    ],
    engagement: [
        "Bride's Family", "Groom's Family", "Relative", "Friend", "Family Friend",
        "Colleague", "Neighbor", "Other",
    ],
    birthday: [
        "Father", "Mother", "Brother", "Sister", "Spouse", "Son", "Daughter",
        "Relative", "Friend", "Best Friend", "School Friend", "College Friend",
        "Colleague", "Neighbor", "Other",
    ],
    baby_shower: [
        "Father's Family", "Mother's Family", "Grandparent", "Uncle", "Aunt",
        "Cousin", "Relative", "Family Friend", "Friend", "Colleague", "Neighbor", "Other",
    ],
    housewarming: [
        "Family", "Relative", "Friend", "Family Friend", "Neighbor", "Colleague",
        "Business Associate", "Other",
    ],
    graduation: [
        "Parent", "Sibling", "Relative", "Friend", "School Friend", "College Friend",
        "Teacher", "Professor", "Classmate", "Alumni", "Colleague", "Other",
    ],
    corporate: [
        "Employee", "Colleague", "Manager", "Management", "Client", "Customer",
        "Vendor", "Supplier", "Business Partner", "Investor", "Sponsor", "Speaker",
        "Delegate", "Media", "Guest", "Other",
    ],
    conference: [
        "Attendee", "Speaker", "Guest Speaker", "Organizer", "Sponsor", "Exhibitor",
        "Delegate", "Student", "Faculty", "Professional", "Media", "VIP Guest", "Other",
    ],
    festival: [
        "Family", "Relative", "Friend", "Community Member", "Organizer", "Performer",
        "Volunteer", "Sponsor", "VIP Guest", "General Guest", "Other",
    ],
    religious: [
        "Family", "Relative", "Friend", "Family Friend", "Community Member", "Devotee",
        "Religious Organization Member", "Volunteer", "Guest", "Other",
    ],
    sports: [
        "Player", "Parent", "Coach", "Team Member", "Support Staff", "Organizer",
        "Sponsor", "Spectator", "Media", "VIP Guest", "Other",
    ],
    school_college: [
        "Student", "Parent", "Teacher", "Faculty", "Alumni", "Management", "Guest",
        "Sponsor", "Volunteer", "Other",
    ],
    concert: [
        "Attendee", "Fan", "Performer", "Artist", "Crew", "Organizer", "Sponsor",
        "Media", "VIP Guest", "Other",
    ],
    anniversary: [
        "Son", "Daughter", "Family", "Relative", "Friend", "Family Friend",
        "Colleague", "Neighbor", "Other",
    ],
    memorial: [
        "Family", "Relative", "Family Friend", "Friend", "Colleague", "Neighbor",
        "Community Member", "Other",
    ],
    social: [
        "Member", "Family", "Friend", "Volunteer", "Organizer", "Sponsor",
        "Community Member", "Guest", "Other",
    ],
    exhibition: [
        "Visitor", "Exhibitor", "Vendor", "Business Partner", "Buyer", "Sponsor",
        "Speaker", "Media", "Organizer", "VIP Guest", "Other",
    ],
};

const FOOD = {
    null: ["Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food", "Halal Food", "No Preference", "Other"],

    wedding: [
        "Pure Vegetarian", "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food",
        "Satvik Food", "Halal Food", "Eggetarian", "Kids Meal", "No Preference", "Other",
    ],
    engagement: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food", "Satvik Food",
        "Halal Food", "Eggetarian", "No Preference", "Other",
    ],
    birthday: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Eggetarian", "Kids Meal",
        "Jain Food", "Halal Food", "No Preference", "Other",
    ],
    baby_shower: [
        "Pure Vegetarian", "Vegetarian", "Vegan", "Jain Food", "Satvik Food",
        "No Onion & Garlic", "Kids Meal", "No Preference", "Other",
    ],
    housewarming: [
        "Pure Vegetarian", "Vegetarian", "Vegan", "Jain Food", "Satvik Food",
        "No Onion & Garlic", "No Preference", "Other",
    ],
    graduation: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Eggetarian", "Jain Food",
        "Halal Food", "Kids Meal", "No Preference", "Other",
    ],
    corporate: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food", "Halal Food",
        "Gluten-Free", "Dairy-Free", "Eggetarian", "No Preference", "Other",
    ],
    conference: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food", "Halal Food",
        "Gluten-Free", "Dairy-Free", "Light Meal", "No Preference", "Other",
    ],
    festival: [
        "Pure Vegetarian", "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food",
        "Satvik Food", "Halal Food", "Traditional Meal", "No Preference", "Other",
    ],
    religious: [
        "Pure Vegetarian", "Satvik Food", "Jain Food", "Vegan", "No Onion & Garlic",
        "Prasadam / Temple Meal", "Fasting Meal", "No Preference", "Other",
    ],
    sports: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "High-Protein Meal", "Light Meal",
        "Kids Meal", "Gluten-Free", "No Preference", "Other",
    ],
    school_college: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Kids Meal", "Jain Food",
        "Halal Food", "No Preference", "Other",
    ],
    concert: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food", "Halal Food",
        "Snacks Only", "No Preference", "Other",
    ],
    anniversary: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food", "Satvik Food",
        "Halal Food", "Eggetarian", "No Preference", "Other",
    ],
    memorial: [
        "Pure Vegetarian", "Vegetarian", "Vegan", "Jain Food", "Satvik Food",
        "No Onion & Garlic", "No Preference", "Other",
    ],
    social: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food", "Halal Food",
        "Kids Meal", "No Preference", "Other",
    ],
    exhibition: [
        "Vegetarian", "Non-Vegetarian", "Vegan", "Jain Food", "Halal Food",
        "Gluten-Free", "Snacks Only", "No Preference", "Other",
    ],
};

/** Resolve every category key to a real id, creating the ones that are missing. */
async function resolveCategories() {
    const ids = {};
    let created = 0;

    for (const cat of CATEGORIES) {
        const [row, wasCreated] = await EventCategory.findOrCreate({
            where: { company_id: COMPANY_ID, name: cat.name },
            defaults: {
                company_id: COMPANY_ID,
                name: cat.name,
                description: `${cat.name} events`,
                icon: cat.icon || '',
                color: cat.color || null,
                sort_order: cat.sort_order || 0,
                is_active: 1,
            },
        });

        ids[cat.key] = row.id;
        if (wasCreated) {
            created += 1;
            console.log(`  + category  ${cat.name} (id ${row.id})`);
        } else {
            console.log(`  = category  ${cat.name} (id ${row.id})`);
        }
    }

    return { ids, created };
}

/**
 * Insert the values missing from one list.
 *
 * `sort_order` follows the position in this file, so the dropdown reads in the
 * order the lists were written rather than alphabetically — "Other" belongs at
 * the bottom, not between "Neighbor" and "Parent".
 */
async function seedList(Model, label, lists, categoryIds) {
    let added = 0;
    let skipped = 0;

    for (const [key, values] of Object.entries(lists)) {
        // Object keys are strings, so the fallback list arrives as "null".
        const categoryId = key === 'null' ? null : categoryIds[key];
        if (key !== 'null' && !categoryId) {
            console.log(`  ! ${label}: no category for key "${key}" — skipped`);
            continue;
        }

        const existing = await Model.findAll({
            where: { company_id: COMPANY_ID, event_category_id: categoryId },
            attributes: ['name'],
        });
        const have = new Set(existing.map((r) => r.name));

        const rows = [];
        values.forEach((name, index) => {
            if (have.has(name)) {
                skipped += 1;
                return;
            }
            rows.push({
                company_id: COMPANY_ID,
                event_category_id: categoryId,
                name,
                sort_order: index + 1,
                is_active: 1,
            });
        });

        if (rows.length) {
            await Model.bulkCreate(rows);
            added += rows.length;
        }
    }

    console.log(`  ${label}: ${added} added, ${skipped} already present`);
    return added;
}

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);

    try {
        if (CLEAR) {
            // Hard delete: these are paranoid tables, and a soft-deleted row would
            // keep its name and block the re-insert that follows.
            const r = await GuestRelationshipOption.destroy({ where: {}, force: true });
            const f = await GuestFoodPreferenceOption.destroy({ where: {}, force: true });
            console.log(`  --clear: removed ${r} relationship and ${f} food rows\n`);
        }

        console.log('Categories');
        const { ids, created } = await resolveCategories();
        console.log(`  ${created} created, ${CATEGORIES.length - created} already present\n`);

        console.log('Options');
        await seedList(GuestRelationshipOption, 'relationships', RELATIONSHIPS, ids);
        await seedList(GuestFoodPreferenceOption, 'food preferences', FOOD, ids);

        const relTotal = await GuestRelationshipOption.count();
        const foodTotal = await GuestFoodPreferenceOption.count();
        console.log(`\nTotals: ${relTotal} relationship rows, ${foodTotal} food rows\n`);
    } catch (err) {
        console.error('\nFAILED:', err.message, '\n');
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
