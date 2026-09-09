#!/usr/bin/env node
/**
 * `notification_templates` grows `trigger_key` — the explicit link between a
 * template and the system event that should fire it.
 *
 * ── WHY THIS REPLACES NAME-MATCHING ──────────────────────────────────────────
 * `notificationTrigger.service.js` used to find the "Welcome Invitation"
 * template by `name LIKE 'Welcome Invitation%'`. That silently breaks the
 * moment an admin renames the template — no error, the notification just
 * stops sending. `trigger_key` is a fixed machine value the admin picks from
 * a dropdown (see `notificationTemplate.service.js`'s SYSTEM_TRIGGERS), so
 * renaming the display `name` can never disconnect it from its trigger.
 *
 * UNIQUE on purpose: only one template may claim a given system trigger at a
 * time, so there is never ambiguity about which one fires.
 *
 * This migration also backfills the existing "Welcome Invitation%" template
 * (the one row created under the old convention) with trigger_key =
 * 'welcome_invitation', so nothing already wired stops working.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-notification-template-trigger-key.js
 *   node src/database/tools/apply-notification-template-trigger-key.js --apply
 *   node src/database/tools/apply-notification-template-trigger-key.js --prod --apply
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

const TABLE = 'notification_templates';
const COLUMN = 'trigger_key';
const INDEX = 'uq_notification_templates_trigger_key';

async function hasColumn(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.DB_NAME, TABLE, COLUMN],
    );
    return rows.length > 0;
}

async function hasIndex(conn) {
    const [rows] = await conn.query(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [process.env.DB_NAME, TABLE, INDEX],
    );
    return rows.length > 0;
}

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
        let columnExists = await hasColumn(conn);
        if (columnExists) {
            console.log(`  = ${COLUMN.padEnd(30)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${COLUMN.padEnd(30)} WOULD ADD`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${COLUMN}\` VARCHAR(50) NULL AFTER \`name\``,
            );
            console.log(`  + ${COLUMN.padEnd(30)} added`);
            columnExists = true;
        }

        if (await hasIndex(conn)) {
            console.log(`  = ${INDEX.padEnd(38)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${INDEX.padEnd(38)} WOULD ADD`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\` ADD UNIQUE KEY \`${INDEX}\` (\`${COLUMN}\`)`,
            );
            console.log(`  + ${INDEX.padEnd(38)} added`);
        }

        console.log('');

        // Backfill the one row that was relying on the old name-prefix match.
        // Only possible once the column actually exists (either already there,
        // or just added above under --apply).
        if (!columnExists) {
            console.log('  = welcome_invitation backfill    column not present yet (dry run)');
        } else {
            const [rows] = await conn.query(
                `SELECT id, name FROM \`${TABLE}\`
                  WHERE name LIKE 'Welcome Invitation%' AND (\`${COLUMN}\` IS NULL OR \`${COLUMN}\` = '')
                  ORDER BY sort_order ASC, id ASC LIMIT 1`,
            );
            if (!rows.length) {
                console.log('  = welcome_invitation backfill    no matching untagged row found');
            } else if (!APPLY) {
                console.log(`  + welcome_invitation backfill    WOULD SET on id=${rows[0].id} ("${rows[0].name}")`);
            } else {
                await conn.query(`UPDATE \`${TABLE}\` SET \`${COLUMN}\` = 'welcome_invitation' WHERE id = ?`, [rows[0].id]);
                console.log(`  + welcome_invitation backfill    set on id=${rows[0].id} ("${rows[0].name}")`);
            }
        }

        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
