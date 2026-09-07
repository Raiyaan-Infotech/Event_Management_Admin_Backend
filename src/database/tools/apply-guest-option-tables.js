#!/usr/bin/env node
/**
 * Guest registration dropdowns — the two lists the mobile app's "Guest Details"
 * form offers, scoped per event category.
 *
 *   guest_relationship_options       "Relationship with Invitor"
 *   guest_food_preference_options    "Food Preference"
 *
 * ── WHY TABLES AND NOT A HARDCODED LIST ─────────────────────────────────────
 * These dropdowns are rendered by a FLUTTER APP. A hardcoded list can only be
 * changed by shipping a new build through app-store review — days, to add one
 * food option. Admin-managed rows change instantly for every installed app.
 *
 * ── SCOPED BY CATEGORY, WITH A GLOBAL FALLBACK ──────────────────────────────
 * A wedding offers "Bride's Father"; a corporate event offers "Delegate". So
 * `event_category_id` scopes each row, exactly as `religions` is scoped.
 *
 * It is NULLABLE here, and religions' is not, on purpose: `events.event_category_id`
 * is itself nullable, so an event can exist with no category at all. Rows with
 * NULL are the fallback list those events fall back to — without them a guest
 * would open the form and find an empty dropdown with nothing to pick.
 *
 * ── WHY THE SAME WORD REPEATS ACROSS CATEGORIES ─────────────────────────────
 * "Other" belongs to all 17 categories and "Vegetarian" to most, and each gets
 * its own row rather than a shared value plus a link table. Chosen deliberately
 * (the alternative was costed and rejected): the admin screen is then ONE page
 * — pick a category, edit its list — instead of managing a value pool and then
 * mapping it. The trade is that renaming a shared word means editing it per
 * category, which is rare; adding and hiding values per category is not.
 *
 * ── NO UNIQUE INDEX ON (category, name) ─────────────────────────────────────
 * Matching `religions` and `event_categories`, which also have none. These
 * tables are `paranoid` — a soft-deleted row keeps its name, so a DB-level
 * unique index would refuse to re-create a value somebody had deleted. The
 * services enforce uniqueness against LIVE rows instead, the same way
 * eventCategory.service.js does.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-guest-option-tables.js
 *   node src/database/tools/apply-guest-option-tables.js --apply
 *   node src/database/tools/apply-guest-option-tables.js --prod --apply
 *
 * Dry runs by default; `--prod` dry-runs too until `--apply` is added.
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

/**
 * Read the referenced column's exact type rather than assuming it.
 *
 * `event_categories.id` is INT UNSIGNED and a signed INT here would make the
 * foreign key impossible — the mistake this project has already paid for
 * repeatedly (see the FK-type note in CLAUDE.md).
 */
async function categoryIdType(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_categories' AND COLUMN_NAME = 'id'`,
        [process.env.DB_NAME],
    );
    if (!rows.length) throw new Error('event_categories.id not found — wrong database?');
    return rows[0].COLUMN_TYPE.toUpperCase();
}

/** Both tables are the same shape; only the name and the FK label differ. */
const table = (name, fkType) => `
CREATE TABLE IF NOT EXISTS \`${name}\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- NULL = the fallback list, offered when an event has no category, or its
  -- category has no list of its own. See the header.
  \`event_category_id\` ${fkType} NULL,

  \`name\`              VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`description\`       TEXT COLLATE utf8mb4_unicode_ci,
  \`icon\`              VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT '',
  \`color\`             VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`sort_order\`        INT NOT NULL DEFAULT 0,
  \`is_active\`         TINYINT NOT NULL DEFAULT 1 COMMENT '0=inactive, 1=active, 2=pending approval',

  \`company_id\`        INT UNSIGNED DEFAULT NULL,
  \`created_by\`        INT UNSIGNED DEFAULT NULL,
  \`updated_by\`        INT UNSIGNED DEFAULT NULL,

  \`created_at\`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`deleted_at\`        DATETIME DEFAULT NULL,

  PRIMARY KEY (\`id\`),
  KEY \`idx_${name}_listing\` (\`company_id\`, \`deleted_at\`, \`is_active\`, \`sort_order\`),
  -- The dropdown's own query: one category's live values, already in order.
  KEY \`idx_${name}_scope\` (\`company_id\`, \`event_category_id\`, \`deleted_at\`, \`is_active\`, \`sort_order\`),
  KEY \`fk_${name}_category\` (\`event_category_id\`),
  CONSTRAINT \`fk_${name}_category\` FOREIGN KEY (\`event_category_id\`)
    REFERENCES \`event_categories\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const TABLES = ['guest_relationship_options', 'guest_food_preference_options'];

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        const fkType = await categoryIdType(conn);
        console.log(`  event_categories.id is ${fkType} — foreign keys will match it\n`);

        for (const name of TABLES) {
            const [existing] = await conn.query(
                `SELECT TABLE_NAME FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [process.env.DB_NAME, name],
            );

            if (existing.length) {
                console.log(`  = ${name.padEnd(30)} already present, skipping`);
            } else if (!APPLY) {
                console.log(`  + ${name.padEnd(30)} WOULD CREATE`);
            } else {
                await conn.query(table(name, fkType));
                console.log(`  + ${name.padEnd(30)} created`);
            }
        }

        console.log('');
        for (const name of TABLES) {
            const [cols] = await conn.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [process.env.DB_NAME, name],
            );
            if (cols.length) console.log(`  ${name}: ${cols.length} columns.`);
        }
        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
