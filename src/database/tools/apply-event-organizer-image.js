#!/usr/bin/env node
/**
 * `events` grows `organizer_image` — the organizer's photo or logo.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * The mobile Create Event wizard's Invitation Details page asks for it next to
 * Organizer / Hosted By, Contact Number, Contact Email and Footer Note. Until
 * now the organizer was a name only.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 * VARCHAR(500) NULL, the same as `cover_image`: the stored URL
 * `mediaService.upload` returns. NULL means "no organizer image", so existing
 * events and the portal wizard (which does not ask for one) are untouched.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-event-organizer-image.js
 *   node src/database/tools/apply-event-organizer-image.js --apply
 *   node src/database/tools/apply-event-organizer-image.js --prod
 *   node src/database/tools/apply-event-organizer-image.js --prod --apply
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
const COLUMN = 'organizer_image';

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
            console.log(`  + ${COLUMN.padEnd(20)} WOULD ADD  (varchar(500) NULL, after cover_image)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD COLUMN \`${COLUMN}\` VARCHAR(500) NULL
                   COMMENT 'The organizer''s photo or logo, asked with the invitation details. NULL = none'
                   AFTER \`cover_image\``,
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
