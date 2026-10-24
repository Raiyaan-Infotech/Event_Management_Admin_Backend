#!/usr/bin/env node
/**
 * Near By (2026-10-24): adds events.nearby_settings and the
 * event_nearby_cache table
 * (src/database/migrations/sql/20261024-event-nearby-settings.sql).
 *
 * Re-runnable: an existing column / table is left alone.
 *
 *   node src/database/tools/apply-event-nearby-settings.js                  dry run, local
 *   node src/database/tools/apply-event-nearby-settings.js --apply          local
 *   node src/database/tools/apply-event-nearby-settings.js --prod           dry run, production
 *   node src/database/tools/apply-event-nearby-settings.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend — the Event
 * model reads nearby_settings, so every event query fails without it.
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261024-event-nearby-settings.sql');

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);

    try {
        const [[col]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'nearby_settings'`,
            [process.env.DB_NAME],
        );
        const [[tbl]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_nearby_cache'`,
            [process.env.DB_NAME],
        );
        const say = (has, what) => console.log(has
            ? `  = ${what.padEnd(26)} already exists`
            : `  + ${what.padEnd(26)} ${APPLY ? 'adding' : 'WOULD ADD'}`);
        say(col.n > 0, 'events.nearby_settings');
        say(tbl.n > 0, 'event_nearby_cache');

        if ((!col.n || !tbl.n) && APPLY) {
            const sql = fs.readFileSync(SQL_FILE, 'utf8')
                .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
                // The trailing check SELECTs are for a hand run; not needed here.
                .replace(/SELECT COLUMN_NAME[\s\S]*$/, '');
            await conn.query(sql);
            console.log('    done');
        }
        if (!APPLY) console.log('\nDry run — add --apply to write.');
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
