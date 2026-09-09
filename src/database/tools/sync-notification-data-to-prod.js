#!/usr/bin/env node
/**
 * Copies notification_categories / notification_templates rows that exist
 * only on LOCAL up to PRODUCTION — a one-off data sync, not a schema
 * migration (both already ran via apply-notification-*.js).
 *
 * ── WHY THIS CANNOT BE A RAW ID COPY ─────────────────────────────────────────
 * local Wedding = event_categories.id 1, prod Wedding = id 2. Local Christian
 * Wedding = event_types.id 2, prod = id 6. Copying a template's
 * event_category_id/event_type_id verbatim would silently attach it to
 * whatever category/type happens to hold that id on prod — a different,
 * wrong one. Every foreign id is re-resolved by NAME against prod, never
 * copied as a number.
 *
 * ── WHAT COUNTS AS "LOCAL ONLY" ──────────────────────────────────────────────
 * Categories: every row NOT matching one of the four seeded default names
 * (Event & Invitation / RSVP & Participation / Schedule & Reminder / System)
 * — those already exist on prod from apply-notification-categories.js.
 * Templates: every LIVE row (deleted_at IS NULL) — soft-deleted rows (this
 * session's smoke-test leftovers) are skipped on purpose.
 *
 * Matched against prod BY NAME before inserting, so a second run reports
 * "already present" rather than duplicating.
 *
 * ── HOW TO RUN ─────────────────────────────────────────────────────────────
 *   node src/database/tools/sync-notification-data-to-prod.js
 *   node src/database/tools/sync-notification-data-to-prod.js --apply
 *
 * Dry runs by default.
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const DEFAULT_CATEGORY_NAMES = new Set([
    'Event & Invitation', 'RSVP & Participation', 'Schedule & Reminder', 'System',
]);

async function connectLocal() {
    // dotenv already loaded the plain .env above — this IS local.
    return mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });
}

async function connectProd() {
    const prodEnv = { ...process.env };
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: { rejectUnauthorized: false },
    });
    // Restore local env vars so anything reading process.env afterwards is unaffected.
    Object.assign(process.env, prodEnv);
    return conn;
}

async function findIdByName(conn, table, name, extraWhere = '') {
    if (name === null || name === undefined) return null;
    const [rows] = await conn.query(
        `SELECT id FROM \`${table}\` WHERE name = ? ${extraWhere} LIMIT 1`,
        [name],
    );
    return rows.length ? rows[0].id : undefined; // undefined = not found, distinct from null
}

(async () => {
    const local = await connectLocal();
    const prodHostForLog = (() => {
        // Peek at .env.production without mutating process.env yet, just for the banner.
        const dotenv = require('dotenv');
        const parsed = dotenv.parse(require('fs').readFileSync(path.join(__dirname, '..', '..', '..', '.env.production')));
        return `${parsed.DB_NAME} @ ${parsed.DB_HOST}`;
    })();

    console.log('');
    console.log(`  local  : ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(`  prod   : ${prodHostForLog}`);
    console.log(`  mode   : ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to write)'}`);
    console.log('');

    const prod = await connectProd();

    try {
        /* ── 1. Categories ─────────────────────────────────────────────── */
        console.log('  notification_categories');
        const [localCats] = await local.query(
            'SELECT id, name, description, icon, color, sort_order, is_active FROM notification_categories WHERE deleted_at IS NULL',
        );
        const customLocalCats = localCats.filter((c) => !DEFAULT_CATEGORY_NAMES.has(c.name));

        // Resolve every category name (default + custom) to a prod id, since
        // templates need the FULL map, not just the custom ones.
        const categoryIdByName = new Map();
        for (const name of DEFAULT_CATEGORY_NAMES) {
            const id = await findIdByName(prod, 'notification_categories', name);
            if (id !== undefined) categoryIdByName.set(name, id);
        }

        for (const cat of customLocalCats) {
            const existingId = await findIdByName(prod, 'notification_categories', cat.name);
            if (existingId !== undefined) {
                console.log(`  = ${cat.name.padEnd(30)} already present (prod id ${existingId})`);
                categoryIdByName.set(cat.name, existingId);
                continue;
            }
            if (!APPLY) {
                console.log(`  + ${cat.name.padEnd(30)} WOULD INSERT`);
                continue;
            }
            const [res] = await prod.query(
                `INSERT INTO notification_categories (name, description, icon, color, sort_order, is_active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [cat.name, cat.description, cat.icon, cat.color, cat.sort_order, cat.is_active],
            );
            categoryIdByName.set(cat.name, res.insertId);
            console.log(`  + ${cat.name.padEnd(30)} inserted (prod id ${res.insertId})`);
        }

        /* ── 2. Templates ──────────────────────────────────────────────── */
        console.log('');
        console.log('  notification_templates');
        const [localTemplates] = await local.query(`
            SELECT t.*, nc.name AS category_name, ec.name AS event_category_name, et.name AS event_type_name
              FROM notification_templates t
              LEFT JOIN notification_categories nc ON nc.id = t.notification_category_id
              LEFT JOIN event_categories ec ON ec.id = t.event_category_id
              LEFT JOIN event_types et ON et.id = t.event_type_id
             WHERE t.deleted_at IS NULL
        `);

        if (!localTemplates.length) {
            console.log('  (no live templates on local)');
        }

        for (const t of localTemplates) {
            const existingId = await findIdByName(prod, 'notification_templates', t.name);
            if (existingId !== undefined) {
                console.log(`  = ${t.name.padEnd(30)} already present (prod id ${existingId})`);
                continue;
            }

            const prodCategoryId = categoryIdByName.get(t.category_name);
            if (prodCategoryId === undefined) {
                console.log(`  ! ${t.name.padEnd(30)} SKIPPED — notification category "${t.category_name}" not found on prod`);
                continue;
            }

            let prodEventCategoryId = null;
            if (t.event_category_name) {
                const id = await findIdByName(prod, 'event_categories', t.event_category_name);
                if (id === undefined) {
                    console.log(`  ! ${t.name.padEnd(30)} SKIPPED — event category "${t.event_category_name}" not found on prod`);
                    continue;
                }
                prodEventCategoryId = id;
            }

            let prodEventTypeId = null;
            if (t.event_type_name) {
                const id = await findIdByName(
                    prod, 'event_types', t.event_type_name,
                    prodEventCategoryId ? `AND event_category_id = ${Number(prodEventCategoryId)}` : '',
                );
                if (id === undefined) {
                    console.log(`  ! ${t.name.padEnd(30)} SKIPPED — event type "${t.event_type_name}" not found on prod`);
                    continue;
                }
                prodEventTypeId = id;
            }

            // trigger_key is UNIQUE on prod too — carry it over as-is (it's a
            // fixed machine key, not per-environment) but never silently steal
            // it from a template that already owns it there.
            if (t.trigger_key) {
                const [clash] = await prod.query(
                    'SELECT id, name FROM notification_templates WHERE trigger_key = ? LIMIT 1',
                    [t.trigger_key],
                );
                if (clash.length) {
                    console.log(`  ! ${t.name.padEnd(30)} SKIPPED — trigger_key "${t.trigger_key}" already owned by prod id ${clash[0].id} ("${clash[0].name}")`);
                    continue;
                }
            }

            if (!APPLY) {
                console.log(`  + ${t.name.padEnd(30)} WOULD INSERT (category -> ${prodCategoryId}, event_category -> ${prodEventCategoryId}, event_type -> ${prodEventTypeId})`);
                continue;
            }

            await prod.query(
                `INSERT INTO notification_templates
                   (name, trigger_key, notification_category_id, event_category_id, event_type_id, title, content,
                    variables_used, image_url, channels, is_active, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    t.name, t.trigger_key ?? null, prodCategoryId, prodEventCategoryId, prodEventTypeId, t.title, t.content,
                    // JSON columns: mysql2 returns these already parsed on SELECT, but a raw
                    // INSERT (unlike Sequelize) needs them re-stringified by hand.
                    JSON.stringify(t.variables_used), t.image_url, JSON.stringify(t.channels),
                    t.is_active, t.sort_order,
                ],
            );
            console.log(`  + ${t.name.padEnd(30)} inserted`);
        }

        console.log('');
    } finally {
        await local.end();
        await prod.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
