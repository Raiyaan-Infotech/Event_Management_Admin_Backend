#!/usr/bin/env node
/**
 * Renames the "Contact Us" event menu to "Contact Person" (2026-10-26)
 * (src/database/migrations/sql/20261026-contact-us-to-contact-person.sql).
 *
 * Re-runnable: a row already renamed is left alone.
 *
 *   node src/database/tools/apply-contact-person-menu.js                  dry run, local
 *   node src/database/tools/apply-contact-person-menu.js --apply          local
 *   node src/database/tools/apply-contact-person-menu.js --prod           dry run, production
 *   node src/database/tools/apply-contact-person-menu.js --prod --apply   production
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261026-contact-us-to-contact-person.sql');

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
            "SELECT id, name FROM event_menus WHERE slug = 'contact-us'",
        );
        if (!rows.length) {
            console.log("  ! no event_menus row with slug 'contact-us'");
        }
        for (const r of rows) {
            console.log(r.name === 'Contact Us'
                ? `  ~ #${r.id} "${r.name}" -> "Contact Person"  ${APPLY ? 'renaming' : 'WOULD RENAME'}`
                : `  = #${r.id} "${r.name}"  left as it is`);
        }
        if (APPLY && rows.some((r) => r.name === 'Contact Us')) {
            const sql = fs.readFileSync(SQL_FILE, 'utf8')
                .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
            const [res] = await conn.query(sql);
            console.log(`    done (${res.affectedRows} row)`);
        }
        if (!APPLY) console.log('\nDry run — add --apply to write.');
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
