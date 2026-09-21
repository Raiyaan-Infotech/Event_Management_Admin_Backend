#!/usr/bin/env node
/**
 * `event_guests` grows `date_of_birth` — asked on the Add Guest forms.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * The app's Member Profile had a Date of Birth row that could only ever show
 * an em-dash: no column held it and no form asked for it. Jamal asked for it
 * on the guest form, so the portal's Add Guest, the app's Add Guest and Add
 * Family Member now collect it, and the profile reads it back.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 * DATE NULL, after `title`. A date, not a datetime: nobody's birthday has a
 * time zone, and a DATETIME would shift it by a day for whoever reads it west
 * of where it was typed. NULL for every existing guest — defaulting would
 * invent a birthday for a real person.
 *
 * ⚠ RUN ON PRODUCTION BEFORE DEPLOYING THE BACKEND. The model selects every
 * column, so a deploy without it makes every guest query fail with
 * `Unknown column 'date_of_birth'`.
 *
 *   node src/database/tools/apply-guest-date-of-birth.js
 *   node src/database/tools/apply-guest-date-of-birth.js --apply
 *   node src/database/tools/apply-guest-date-of-birth.js --prod
 *   node src/database/tools/apply-guest-date-of-birth.js --prod --apply
 *
 * Dry runs by default; re-running is a no-op once the column exists.
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const TABLE = 'event_guests';
const COLUMN = 'date_of_birth';

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
            console.log(`  + ${COLUMN.padEnd(20)} WOULD ADD  (date NULL, after title)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD COLUMN \`${COLUMN}\` DATE NULL
                   COMMENT 'Asked on the Add Guest forms. NULL = not given'
                   AFTER \`title\``,
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
