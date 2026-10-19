#!/usr/bin/env node
/**
 * Adds `website_clients.quick_actions` (JSON) — the organizer's Home Quick
 * Actions, an ordered list of menu slugs from their plan (2026-10-19).
 * Same change as src/database/migrations/sql/20261019-client-quick-actions.sql.
 *
 * ⚠ ORDER: run on production BEFORE the backend that has the column in the
 * WebsiteClient model is deployed — otherwise every website_clients read fails
 * with "Unknown column".
 *
 *   node src/database/tools/apply-client-quick-actions.js                 dry run, local
 *   node src/database/tools/apply-client-quick-actions.js --apply         local
 *   node src/database/tools/apply-client-quick-actions.js --prod          dry run, production
 *   node src/database/tools/apply-client-quick-actions.js --prod --apply  production
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
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);
    try {
        const [rows] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'quick_actions'`,
            [process.env.DB_NAME],
        );
        if (rows.length) {
            console.log('  = website_clients.quick_actions   already there');
            return;
        }
        if (!APPLY) {
            console.log('  + website_clients.quick_actions   WOULD ADD (json NULL)');
            console.log('\nRe-run with --apply to write it.');
            return;
        }
        await conn.query(
            "ALTER TABLE `website_clients` ADD COLUMN `quick_actions` json DEFAULT NULL COMMENT 'Home Quick Actions: ordered menu slugs from the plan, NULL = default set'",
        );
        console.log('  + website_clients.quick_actions   added');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
