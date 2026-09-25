#!/usr/bin/env node
/**
 * `events` grows `invitation_image` — the finished invitation as a PNG.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * The invitation is drawn by the client portal (React `InvitationCard`), and
 * until now it existed as an image only for the moment someone pressed
 * Download. The app had nothing to show, so its View Invitation screen drew an
 * approximation. Now the portal wizard renders the card to PNG when an event is
 * saved and uploads it; this column holds that URL and the app shows it as is.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 * VARCHAR(500) NULL, the same as `cover_image`: the URL `mediaService.upload`
 * returns. NULL = not rendered yet (an event saved before this existed); the
 * app then falls back to its drawn card.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/add-event-invitation-image.js
 *   node src/database/tools/add-event-invitation-image.js --apply
 *   node src/database/tools/add-event-invitation-image.js --prod
 *   node src/database/tools/add-event-invitation-image.js --prod --apply
 *
 * Dry runs by default. Re-running is a no-op once the column exists.
 * ⚠ Run on production BEFORE deploying the code: the model selects the column.
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
const COLUMN = 'invitation_image';

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
                   COMMENT 'The finished invitation as a PNG, uploaded by the portal wizard on save'
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
