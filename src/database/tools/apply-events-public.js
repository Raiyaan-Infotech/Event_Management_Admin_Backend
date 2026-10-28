#!/usr/bin/env node
/**
 * Events PUBLIC by default (2026-10-28): changes the `events.privacy` default
 * to 'public' and sets every existing event to public
 * (src/database/migrations/sql/20261028-events-public.sql). Re-runnable.
 *
 *   node src/database/tools/apply-events-public.js                 dry run, local
 *   node src/database/tools/apply-events-public.js --apply         local
 *   node src/database/tools/apply-events-public.js --prod          dry run, production
 *   node src/database/tools/apply-events-public.js --prod --apply  production
 *
 * Order does not matter against the backend push: the model reads the same
 * column either way.
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261028-events-public.sql');

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
        const [[col]] = await conn.query(
            `SELECT COLUMN_DEFAULT AS d FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'privacy'`,
            [process.env.DB_NAME],
        );
        const [counts] = await conn.query(
            'SELECT privacy, COUNT(*) AS n FROM events GROUP BY privacy',
        );
        console.log(`  default now: ${col?.d}`);
        console.log(`  events: ${counts.map((r) => `${r.privacy} ${r.n}`).join(', ') || 'none'}`);
        const toChange = counts.filter((r) => r.privacy !== 'public').reduce((s, r) => s + Number(r.n), 0);
        console.log(`  → default 'public'${col?.d === 'public' ? ' (already)' : ''}, ${toChange} event(s) to public`
            + (APPLY ? '' : '   (dry run — nothing written)'));

        if (APPLY) {
            const statements = fs.readFileSync(SQL_FILE, 'utf8')
                .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
                .split(';').map((s) => s.trim()).filter(Boolean);
            for (const s of statements) await conn.query(s);
            const [after] = await conn.query('SELECT privacy, COUNT(*) AS n FROM events GROUP BY privacy');
            console.log(`  ✓ events now: ${after.map((r) => `${r.privacy} ${r.n}`).join(', ')}`);
        }
        console.log('\nDone.\n');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('\n✗', e.message);
    process.exit(1);
});
