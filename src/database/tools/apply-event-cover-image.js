#!/usr/bin/env node
/**
 * `events` grows `cover_image` — one photo the client uploads for an event.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * The mobile app's event list card and the top of the event screen. Until now
 * both could only draw the invitation TEMPLATE's artwork (or a stock photo
 * belonging to nobody), because an event had no image of its own.
 *
 * It is NOT part of the invitation template: the template's background, frame
 * and decorations are unchanged. A cover is the event's own picture — the
 * couple, the venue, the birthday child.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 * VARCHAR(500) NULL, the same as `splash_screens.background_url`: the stored
 * URL `mediaService.upload` returns. NULL means "no cover", and every reader
 * falls back to the template artwork as before, so existing events are
 * untouched.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-event-cover-image.js
 *   node src/database/tools/apply-event-cover-image.js --apply
 *   node src/database/tools/apply-event-cover-image.js --prod
 *   node src/database/tools/apply-event-cover-image.js --prod --apply
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
const COLUMN = 'cover_image';

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
            console.log(`  + ${COLUMN.padEnd(20)} WOULD ADD  (varchar(500) NULL, after primary_color)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD COLUMN \`${COLUMN}\` VARCHAR(500) NULL
                   COMMENT 'The event''s own photo — mobile list card and event screen. NULL = template artwork'
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
