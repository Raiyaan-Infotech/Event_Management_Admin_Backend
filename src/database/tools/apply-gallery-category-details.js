/**
 * Adds `description` and `cover_image` to `event_gallery_categories`.
 *
 * WHY: the app's Add / Edit Gallery Category form (Jamal's "Gallery Category
 * Management" design) has a Description and a Cover Image, and the table held
 * only a name, an icon and an order. Both are nullable — every existing
 * category stays valid, and a category with no cover falls back to its newest
 * photo when it is listed.
 *
 *   node src/database/tools/apply-gallery-category-details.js            (dry run, local)
 *   node src/database/tools/apply-gallery-category-details.js --apply
 *   node src/database/tools/apply-gallery-category-details.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const COLUMNS = [
    {
        name: 'description',
        ddl: 'ADD COLUMN `description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `name`',
    },
    {
        name: 'cover_image',
        ddl: "ADD COLUMN `cover_image` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'NULL = newest photo in the category' AFTER `description`",
    },
];

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const l of raw.split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
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

    const [rows] = await conn.query(
        `SELECT COLUMN_NAME name FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_gallery_categories'`
    );
    if (!rows.length) {
        console.log('event_gallery_categories does not exist — run add-gallery-categories.js first.');
        await conn.end();
        return;
    }
    const present = new Set(rows.map((r) => r.name));
    const missing = COLUMNS.filter((c) => !present.has(c.name));

    for (const c of COLUMNS) {
        console.log(`event_gallery_categories.${c.name}: ${present.has(c.name) ? 'present' : 'TO ADD'}`);
    }

    if (!missing.length) {
        console.log('Nothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    // One ALTER for both — prod is ~370ms a query and a table rebuild each.
    await conn.query(
        `ALTER TABLE \`event_gallery_categories\` ${missing.map((c) => c.ddl).join(', ')}`
    );
    console.log(`Added ${missing.map((c) => c.name).join(', ')}.`);

    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
