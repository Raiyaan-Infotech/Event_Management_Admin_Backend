#!/usr/bin/env node
/**
 * My Favourites (2026-10-28): creates `client_qr_contacts`
 * (src/database/migrations/sql/20261028-client-qr-contacts.sql). Re-runnable.
 *
 *   node src/database/tools/apply-client-qr-contacts.js                 dry run, local
 *   node src/database/tools/apply-client-qr-contacts.js --apply         local
 *   node src/database/tools/apply-client-qr-contacts.js --prod          dry run, production
 *   node src/database/tools/apply-client-qr-contacts.js --prod --apply  production
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261028-client-qr-contacts.sql');

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
        console.log(t.n
            ? '  = client_qr_contacts   already exists'
            : `  + client_qr_contacts   ${APPLY ? 'creating' : 'WOULD CREATE'}`);
        if (!t.n && APPLY) {
            const create = fs.readFileSync(SQL_FILE, 'utf8')
                .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
                .split(';').map((s) => s.trim()).filter(Boolean)[0];
            await conn.query(create);
        }
        console.log('\nDone.\n');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('\n✗', e.message);
    process.exit(1);
});
