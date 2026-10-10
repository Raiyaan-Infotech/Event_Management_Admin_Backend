#!/usr/bin/env node
/**
 * `events` grows `secondary_color` — an accent colour the client selects for an event.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * The invitation card's accent elements: calendar icon, ampersand, details,
 * and decorative lines. Alongside `primary_color` (which drives the host names
 * and QR code), `secondary_color` gives clients full creative control over
 * their invitation card colors.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 * VARCHAR(9) NULL, Hex like #RRGGBB, after `primary_color`. NULL falls back
 * to the template's own `secondary_color`, so existing events remain unchanged.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-event-secondary-color.js
 *   node src/database/tools/apply-event-secondary-color.js --apply
 *   node src/database/tools/apply-event-secondary-color.js --prod
 *   node src/database/tools/apply-event-secondary-color.js --prod --apply
 *
 * Dry runs by default; `--prod` dry-runs too until `--apply` is added.
 * Re-running is a no-op once the column exists.
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

const TABLE = 'events';
const COLUMN = 'secondary_color';

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
        const [rows] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [process.env.DB_NAME, TABLE, COLUMN],
        );

        if (rows.length) {
            console.log(`  = ${COLUMN.padEnd(20)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${COLUMN.padEnd(20)} WOULD ADD  (varchar(9) NULL, after primary_color)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD COLUMN \`${COLUMN}\` VARCHAR(9) NULL
                   COMMENT 'Hex, #RRGGBB or #RRGGBBAA. Accents and secondary details on invitation'
                   AFTER \`primary_color\``,
            );
            console.log(`  + ${COLUMN.padEnd(20)} added`);
        }
        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
