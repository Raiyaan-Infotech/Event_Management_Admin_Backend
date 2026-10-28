#!/usr/bin/env node
/**
 * My Favourites per EVENT and per OWNER (2026-10-28)
 * (src/database/migrations/sql/20261028-qr-contacts-per-event.sql):
 * adds `owner_key` (c:<client> / cp:<contact person>) and
 * `owner_contact_person_id`, fills `owner_key` for existing rows, and makes a
 * row unique per (owner, person, EVENT). Re-runnable: skips when `owner_key`
 * already exists.
 *
 *   node src/database/tools/apply-qr-contacts-per-event.js                 dry run, local
 *   node src/database/tools/apply-qr-contacts-per-event.js --apply         local
 *   node src/database/tools/apply-qr-contacts-per-event.js --prod          dry run, production
 *   node src/database/tools/apply-qr-contacts-per-event.js --prod --apply  production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend.
 */

require('dotenv').config();
const fs = require('fs');
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261028-qr-contacts-per-event.sql');

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
        const [[t]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'client_qr_contacts'`,
            [process.env.DB_NAME],
        );
        if (!t.n) throw new Error('client_qr_contacts is missing — run apply-client-qr-contacts.js first.');
        const [[c]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'client_qr_contacts' AND COLUMN_NAME = 'owner_key'`,
            [process.env.DB_NAME],
        );
        const [[rows]] = await conn.query('SELECT COUNT(*) AS n FROM client_qr_contacts');
        if (c.n) {
            console.log('  = client_qr_contacts.owner_key   already there');
        } else {
            console.log(`  + client_qr_contacts per event / per owner   ${APPLY ? 'applying' : 'WOULD APPLY'} (${rows.n} existing row(s) kept)`);
            if (APPLY) {
                const statements = fs.readFileSync(SQL_FILE, 'utf8')
                    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
                    .split(';').map((s) => s.trim()).filter(Boolean);
                for (const s of statements) await conn.query(s);
                const [[after]] = await conn.query('SELECT COUNT(*) AS n FROM client_qr_contacts WHERE owner_key IS NULL');
                console.log(`  ✓ done, ${after.n} row(s) without an owner`);
            }
        }
        console.log('\nDone.\n');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('\n✗', e.message);
    process.exit(1);
});
