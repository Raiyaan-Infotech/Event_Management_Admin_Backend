#!/usr/bin/env node
/**
 * Participant Edit Profile (2026-10-29) — new website_clients columns:
 *   personal + address: date_of_birth, gender, profession, country, state, city,
 *                       postal_code, address
 *                       (migrations/sql/20261029-client-personal-address.sql)
 *   public visibility:  profile_visibility, visible_fields
 *                       (migrations/sql/20261029-client-profile-visibility.sql)
 *   additional details: cover_image_url, social_links
 *                       (migrations/sql/20261029-client-additional-details.sql)
 * Checks EACH column and adds only the missing ones, so it is safe to re-run
 * after a partial run.
 *
 *   node src/database/tools/apply-client-personal-address.js                 dry run, local
 *   node src/database/tools/apply-client-personal-address.js --apply         local
 *   node src/database/tools/apply-client-personal-address.js --prod          dry run, production
 *   node src/database/tools/apply-client-personal-address.js --prod --apply  production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend (the model reads
 * the new columns).
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

// In order — each goes AFTER the one before it. Same definitions as the SQL files.
const COLUMNS = [
    ['date_of_birth', 'DATE NULL AFTER `bio`'],
    ['gender', "ENUM('male','female','other') NULL AFTER `date_of_birth`"],
    ['profession', 'VARCHAR(100) NULL AFTER `gender`'],
    ['country', 'VARCHAR(100) NULL AFTER `profession`'],
    ['state', 'VARCHAR(100) NULL AFTER `country`'],
    ['city', 'VARCHAR(100) NULL AFTER `state`'],
    ['postal_code', 'VARCHAR(20) NULL AFTER `city`'],
    ['address', 'VARCHAR(500) NULL AFTER `postal_code`'],
    ['profile_visibility', "ENUM('everyone','private') NOT NULL DEFAULT 'everyone' AFTER `address`"],
    ['visible_fields', 'JSON NULL AFTER `profile_visibility`'],
    ['cover_image_url', 'VARCHAR(500) NULL AFTER `avatar_url`'],
    ['social_links', 'JSON NULL AFTER `visible_fields`'],
];

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
            `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients'`,
            [process.env.DB_NAME],
        );
        const have = new Set(rows.map((r) => r.c));
        const missing = COLUMNS.filter(([name]) => !have.has(name));
        for (const [name] of COLUMNS) {
            console.log(have.has(name)
                ? `  = website_clients.${name}   already there`
                : `  + website_clients.${name}   ${APPLY ? 'adding' : 'WOULD ADD'}`);
        }
        if (APPLY && missing.length) {
            // One ALTER — one round trip, and all-or-nothing on the table.
            await conn.query(
                `ALTER TABLE website_clients ${missing.map(([n, def]) => `ADD COLUMN \`${n}\` ${def}`).join(', ')}`,
            );
        }
        console.log('\nDone.\n');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('\n✗', e.message);
    process.exit(1);
});
