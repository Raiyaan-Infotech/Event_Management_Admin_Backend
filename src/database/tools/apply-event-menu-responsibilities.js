#!/usr/bin/env node
/**
 * Contact Person responsibilities (2026-10-26): adds event_menus.responsibilities
 * and seeds the Contact Person menu with the six defaults
 * (src/database/migrations/sql/20261026-event-menu-responsibilities.sql).
 *
 * Re-runnable: the column is added only when missing; the seed only fills a
 * contact-us row whose list is still NULL.
 *
 *   node src/database/tools/apply-event-menu-responsibilities.js                  dry run, local
 *   node src/database/tools/apply-event-menu-responsibilities.js --apply          local
 *   node src/database/tools/apply-event-menu-responsibilities.js --prod           dry run, production
 *   node src/database/tools/apply-event-menu-responsibilities.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend — the EventMenu
 * model reads the column.
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261026-event-menu-responsibilities.sql');

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
        const [alter, seed] = fs.readFileSync(SQL_FILE, 'utf8')
            .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
            .split(';').map((s) => s.trim()).filter(Boolean);

        const [[col]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_menus' AND COLUMN_NAME = 'responsibilities'`,
            [process.env.DB_NAME],
        );
        if (col.n > 0) {
            console.log('  = event_menus.responsibilities   already exists');
        } else {
            console.log(`  + event_menus.responsibilities   ${APPLY ? 'adding' : 'WOULD ADD'}`);
            if (APPLY) await conn.query(alter);
        }

        if (col.n > 0 || APPLY) {
            const [rows] = await conn.query(
                "SELECT id, name, responsibilities FROM event_menus WHERE slug = 'contact-us'",
            );
            for (const r of rows) {
                if (r.responsibilities != null) {
                    console.log(`  = #${r.id} ${r.name}: list already set`);
                } else {
                    console.log(`  ~ #${r.id} ${r.name}: ${APPLY ? 'seeding' : 'WOULD SEED'} the six defaults`);
                }
            }
            if (APPLY && rows.some((r) => r.responsibilities == null)) await conn.query(seed);
        } else {
            console.log("  ~ contact-us menu               WOULD SEED the six defaults");
        }
        if (!APPLY) console.log('\nDry run — add --apply to write.');
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
