#!/usr/bin/env node
/**
 * Mark Attendance (2026-10-28): adds event_participants.checked_in_at /
 * checked_in_by_client_id / checked_in_by_name
 * (src/database/migrations/sql/20261028-participant-check-in.sql). Re-runnable.
 *
 *   node src/database/tools/apply-participant-check-in.js                 dry run, local
 *   node src/database/tools/apply-participant-check-in.js --apply         local
 *   node src/database/tools/apply-participant-check-in.js --prod          dry run, production
 *   node src/database/tools/apply-participant-check-in.js --prod --apply  production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend (the model reads
 * the new columns).
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261028-participant-check-in.sql');

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
        const [[c]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_participants' AND COLUMN_NAME = 'checked_in_at'`,
            [process.env.DB_NAME],
        );
        console.log(c.n
            ? '  = event_participants.checked_in_*   already there'
            : `  + event_participants.checked_in_*   ${APPLY ? 'adding' : 'WOULD ADD'}`);
        if (!c.n && APPLY) {
            const sql = fs.readFileSync(SQL_FILE, 'utf8')
                .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
                .split(';').map((s) => s.trim()).filter(Boolean)[0];
            await conn.query(sql);
        }
        console.log('\nDone.\n');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('\n✗', e.message);
    process.exit(1);
});
