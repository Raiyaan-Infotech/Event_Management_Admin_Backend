#!/usr/bin/env node
/**
 * `website_clients` gains UNIQUE (vendor_id, mobile).
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Email has been unique per vendor since the beginning — `uniq_website_client_email`
 * in the database, `assertEmailFree` in the service. Mobile had NEITHER, so the
 * same number could sit on two accounts, and did.
 *
 * That breaks sign-in rather than merely duplicating a row. `findClientByMobile`
 * — the whole of mobile OTP login — does `findOne` on the number, so with two
 * matching rows it signs somebody into whichever the database returns FIRST.
 * Which one that is can change between queries. A number that identifies two
 * accounts identifies neither.
 *
 * ── THE SERVICE GUARD IS NOT ENOUGH ON ITS OWN ──────────────────────────────
 * `assertMobileFree` now runs on signup, admin create and admin edit, and the
 * QR registration path looks the number up before creating. All of those are
 * check-then-write: two requests arriving together both find nothing and both
 * insert. Only the database can refuse the second one, which is why this index
 * exists as well as the guard, not instead of it.
 *
 * ── NULL IS FREE ────────────────────────────────────────────────────────────
 * Mobile is optional — an admin-created row and a Google sign-in both arrive
 * without one. MySQL permits MANY NULLs in a unique index, so those do not
 * collide. Empty strings WOULD collide, but the services normalise `''` to NULL
 * (`digitsOnly(payload.mobile) || null`), and this script verifies that before
 * touching anything.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-website-client-unique-mobile.js
 *   node src/database/tools/apply-website-client-unique-mobile.js --apply
 *   node src/database/tools/apply-website-client-unique-mobile.js --prod --apply
 *
 * Re-runnable: it does nothing when the index already exists, and it REFUSES to
 * create it while duplicates remain rather than failing halfway through an
 * ALTER — the duplicates are listed so they can be merged by hand first.
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');

const INDEX = 'uniq_website_client_mobile';

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
        const [already] = await conn.query(
            `SELECT INDEX_NAME FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients' AND INDEX_NAME = ?
              LIMIT 1`,
            [process.env.DB_NAME, INDEX],
        );
        if (already.length) {
            console.log(`  = ${INDEX} already exists, nothing to do\n`);
            return;
        }

        // Empty strings are the one thing that would collide where NULL does not.
        const [blanks] = await conn.query(
            "SELECT COUNT(*) AS n FROM website_clients WHERE mobile = ''",
        );
        if (Number(blanks[0].n) > 0) {
            console.log(`  ! ${blanks[0].n} row(s) store '' rather than NULL for mobile.`);
            console.log("    Those WOULD collide. Run:  UPDATE website_clients SET mobile = NULL WHERE mobile = '';\n");
            if (APPLY) throw new Error("empty-string mobiles present — normalise them to NULL first");
        }

        // Soft-deleted rows count: the index covers the whole table, not the
        // paranoid view, so a deleted row still occupies its number.
        const [dups] = await conn.query(
            `SELECT vendor_id, mobile, COUNT(*) AS n,
                    GROUP_CONCAT(id ORDER BY id) AS ids
               FROM website_clients
              WHERE mobile IS NOT NULL AND mobile <> ''
              GROUP BY vendor_id, mobile
             HAVING n > 1
              ORDER BY n DESC`,
        );

        if (dups.length) {
            console.log(`  ! ${dups.length} duplicate (vendor_id, mobile) group(s) — the index cannot be created:\n`);
            for (const d of dups) {
                console.log(`      vendor ${d.vendor_id}  mobile ${d.mobile}  ->  ids [${d.ids}]  (${d.n} rows)`);
            }
            console.log('\n    Merge or remove the extra rows, then run this again.');
            console.log('    Not done automatically: which account is the real one, and what');
            console.log('    happens to the events and guests hanging off the other, is a');
            console.log('    decision about data rather than about schema.\n');
            if (APPLY) throw new Error('duplicates present — resolve them first');
            return;
        }

        console.log('  no duplicates, no empty strings — safe to add');

        if (!APPLY) {
            console.log(`  + WOULD CREATE UNIQUE ${INDEX} (vendor_id, mobile)\n`);
            return;
        }

        await conn.query(
            `ALTER TABLE \`website_clients\`
               ADD UNIQUE INDEX \`${INDEX}\` (\`vendor_id\`, \`mobile\`)`,
        );
        console.log(`  + ${INDEX} (vendor_id, mobile) created\n`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
