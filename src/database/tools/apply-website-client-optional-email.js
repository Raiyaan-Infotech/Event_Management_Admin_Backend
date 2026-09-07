#!/usr/bin/env node
/**
 * `website_clients.email` becomes NULLABLE.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * A guest who registers by scanning the invitation QR proves a MOBILE NUMBER,
 * not an email address — the form marks Email "(Optional)" and means it. The
 * column was NOT NULL, so the first such registration failed outright:
 *
 *   SequelizeValidationError: WebsiteClient.email cannot be null
 *
 * The alternatives were both worse. Forcing an email contradicts the design and
 * blocks a guest who has none; inventing one
 * (`9998887771@no-email.invalid`) writes a fake address into a UNIQUE column
 * that other code is entitled to believe is real, and something would
 * eventually try to email it.
 *
 * ── THE UNIQUE INDEX IS SAFE ────────────────────────────────────────────────
 * `uniq_website_client_email (vendor_id, email)` stays exactly as it is. MySQL
 * permits MANY NULLs in a unique index — only non-null duplicates are refused —
 * so phone-only accounts do not collide with each other, and an account that
 * later adds an email is still held to being the only one with it.
 *
 * ── WHAT THIS DOES NOT CHANGE ───────────────────────────────────────────────
 * Nothing else starts accepting a blank email. The website signup and the admin
 * create both validate it in their own services, and they still do. Only the
 * QR registration path inserts NULL.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-website-client-optional-email.js
 *   node src/database/tools/apply-website-client-optional-email.js --apply
 *   node src/database/tools/apply-website-client-optional-email.js --prod --apply
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
            `SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'email'`,
            [process.env.DB_NAME],
        );
        if (!rows.length) throw new Error('website_clients.email not found — wrong database?');

        const { COLUMN_TYPE: type, IS_NULLABLE: nullable } = rows[0];
        console.log(`  email is currently ${type}, nullable: ${nullable}`);

        if (nullable === 'YES') {
            console.log('  = already nullable, nothing to do\n');
        } else if (!APPLY) {
            console.log('  + WOULD ALTER to allow NULL\n');
        } else {
            // MODIFY keeps the type and collation; only nullability changes.
            await conn.query(
                'ALTER TABLE `website_clients` MODIFY COLUMN `email` VARCHAR(255) '
                + 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
            );
            console.log('  + email now allows NULL\n');
        }

        // Report the index so the reader can see the unique constraint survived.
        const [idx] = await conn.query(
            `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients'
                AND INDEX_NAME = 'uniq_website_client_email'
              ORDER BY SEQ_IN_INDEX`,
            [process.env.DB_NAME],
        );
        if (idx.length) {
            const cols = idx.map((r) => r.COLUMN_NAME).join(', ');
            console.log(`  uniq_website_client_email (${cols}) — ${idx[0].NON_UNIQUE ? 'not unique' : 'still UNIQUE'}`);
            console.log('  (MySQL allows many NULLs in a unique index, so this is safe)\n');
        }
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
