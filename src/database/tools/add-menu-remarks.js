/**
 * Adds `event_menus.remarks` where it is missing.
 *
 * WHY: the Menu form has written a Remarks note (300 chars, with its own
 * counter) and the menu view page has rendered it for a while, but the column
 * only ever reached local — production never got it, so the model selecting it
 * would throw "Unknown column 'remarks'" on the first menu read after a deploy.
 *
 * Additive and idempotent: it adds a nullable column and nothing else.
 *
 *   node src/database/tools/add-menu-remarks.js            (dry run, local)
 *   node src/database/tools/add-menu-remarks.js --apply
 *   node src/database/tools/add-menu-remarks.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

(async () => {
    const env = PROD ? parseEnv('.env.production') : localEnv;
    const conn = await mysql.createConnection({
        host: env.DB_HOST,
        port: env.DB_PORT || 3306,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        charset: 'utf8mb4',
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}`);

    const [cols] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_menus'`
    );
    if (cols.some((c) => c.COLUMN_NAME === 'remarks')) {
        console.log('Nothing to do — remarks already present.');
        await conn.end();
        return;
    }

    console.log('Missing: remarks varchar(300) NULL — to be added after `slug`.');

    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    await conn.query(
        "ALTER TABLE event_menus ADD COLUMN `remarks` varchar(300) " +
        "COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'free-form internal note' AFTER `slug`"
    );
    console.log('Added remarks.');

    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
