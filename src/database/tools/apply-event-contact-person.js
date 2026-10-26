#!/usr/bin/env node
/**
 * Contact Person Profile (2026-10-26): adds the contact person's own columns
 * to `events` (src/database/migrations/sql/20261026-event-contact-person.sql).
 *
 * Re-runnable: each column is added only when it is missing.
 *
 *   node src/database/tools/apply-event-contact-person.js                  dry run, local
 *   node src/database/tools/apply-event-contact-person.js --apply          local
 *   node src/database/tools/apply-event-contact-person.js --prod           dry run, production
 *   node src/database/tools/apply-event-contact-person.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend — the Event
 * model reads these columns, so every event query fails without them.
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261026-event-contact-person.sql');

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
        const statements = fs.readFileSync(SQL_FILE, 'utf8')
            .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
            .split(';').map((s) => s.trim()).filter(Boolean);
        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events'`,
            [process.env.DB_NAME],
        );
        const have = new Set(cols.map((c) => c.COLUMN_NAME));
        for (const sql of statements) {
            const name = sql.match(/ADD COLUMN (\w+)/)[1];
            if (have.has(name)) {
                console.log(`  = events.${name.padEnd(26)} already exists`);
                continue;
            }
            console.log(`  + events.${name.padEnd(26)} ${APPLY ? 'adding' : 'WOULD ADD'}`);
            if (APPLY) await conn.query(sql);
        }
        if (!APPLY) console.log('\nDry run — add --apply to write.');
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
