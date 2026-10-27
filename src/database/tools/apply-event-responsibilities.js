#!/usr/bin/env node
/**
 * Responsibilities module (2026-10-27): creates `event_responsibilities`
 * (src/database/migrations/sql/20261027-event-responsibilities.sql) and copies
 * each Contact Person menu's old list (event_menus.responsibilities) into it,
 * as rows for that menu's event category.
 *
 * Re-runnable: the table is created only when missing; a category that
 * already has rows is not seeded again.
 *
 *   node src/database/tools/apply-event-responsibilities.js                  dry run, local
 *   node src/database/tools/apply-event-responsibilities.js --apply          local
 *   node src/database/tools/apply-event-responsibilities.js --prod           dry run, production
 *   node src/database/tools/apply-event-responsibilities.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this, then the permission seeder
 * (guest-option-permissions.seeder.js --prod), BEFORE pushing the backend.
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261027-event-responsibilities.sql');
const COMPANY_ID = 1;

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
        const create = fs.readFileSync(SQL_FILE, 'utf8')
            .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
            .split(';').map((s) => s.trim()).filter(Boolean)[0];

        const [[t]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_responsibilities'`,
            [process.env.DB_NAME],
        );
        const exists = t.n > 0;
        console.log(exists
            ? '  = event_responsibilities   already exists'
            : `  + event_responsibilities   ${APPLY ? 'creating' : 'WOULD CREATE'}`);
        if (!exists && APPLY) await conn.query(create);

        const [[c]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_menus' AND COLUMN_NAME = 'responsibilities'`,
            [process.env.DB_NAME],
        );
        if (!c.n) {
            console.log('  (no event_menus.responsibilities column — nothing to copy)');
        } else {
            const [menus] = await conn.query(
                `SELECT id, event_category_id, responsibilities FROM event_menus
                 WHERE slug LIKE 'contact-us%' AND responsibilities IS NOT NULL AND deleted_at IS NULL`,
            );
            for (const m of menus) {
                let names = m.responsibilities;
                if (typeof names === 'string') {
                    try { names = JSON.parse(names); } catch { names = []; }
                }
                names = (Array.isArray(names) ? names : []).map(String).filter((n) => n.trim());
                const cat = m.event_category_id ?? null;
                let has = 0;
                if (exists || APPLY) {
                    const [[h]] = await conn.query(
                        `SELECT COUNT(*) AS n FROM event_responsibilities
                         WHERE company_id = ? AND event_category_id <=> ? AND deleted_at IS NULL`,
                        [COMPANY_ID, cat],
                    );
                    has = h.n;
                }
                if (has) {
                    console.log(`  = category ${cat}: already has ${has} rows`);
                    continue;
                }
                console.log(`  + category ${cat}: ${APPLY ? 'adding' : 'WOULD ADD'} ${names.join(', ')}`);
                if (APPLY && names.length) {
                    await conn.query(
                        `INSERT INTO event_responsibilities
                           (event_category_id, name, description, icon, sort_order, is_active, company_id)
                         VALUES ?`,
                        [names.map((n, i) => [cat, n.trim().slice(0, 100), null, '', i + 1, 1, COMPANY_ID])],
                    );
                }
            }
        }
        if (!APPLY) console.log('\nDry run — add --apply to write.');
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
