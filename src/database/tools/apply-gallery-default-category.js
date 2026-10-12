/**
 * Gives every event its built-in "Gallery" category.
 *
 * WHY: photos can now be uploaded straight into an event without choosing a
 * category — they land in a default "Gallery" category that every event always
 * has (it cannot be renamed or deleted). So:
 *   1. `event_gallery_categories.is_default` (1 = the built-in Gallery, NULL =
 *      every other) with a UNIQUE (event_id, is_default) key — NULLs may repeat,
 *      so an event can have many categories but only one default;
 *   2. every event gets its Gallery row (an existing category already named
 *      "Gallery" is adopted instead of duplicated);
 *   3. photos filed under no category move into it.
 * Three set-based statements — prod is ~370ms a query, never row by row.
 * The backend also creates the row lazily, so events made later need nothing.
 *
 *   node src/database/tools/apply-gallery-default-category.js            (dry run, local)
 *   node src/database/tools/apply-gallery-default-category.js --apply
 *   node src/database/tools/apply-gallery-default-category.js --prod --apply
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

    const [[col]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_gallery_categories'
            AND COLUMN_NAME = 'is_default'`
    );
    const [[idx]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_gallery_categories'
            AND INDEX_NAME = 'uq_gallery_cat_default'`
    );
    console.log(`is_default column: ${col.n ? 'present' : 'TO ADD'}`);
    console.log(`unique key:        ${idx.n ? 'present' : 'TO ADD'}`);

    const [[ev]] = await conn.query(
        'SELECT COUNT(*) n FROM events WHERE deleted_at IS NULL'
    );
    const [[unfiled]] = await conn.query(
        'SELECT COUNT(*) n FROM event_gallery_items WHERE category_id IS NULL'
    );
    console.log(`live events: ${ev.n}   photos in no category: ${unfiled.n}`);

    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    if (!col.n) {
        await conn.query(
            `ALTER TABLE event_gallery_categories
               ADD COLUMN is_default tinyint(1) DEFAULT NULL
               COMMENT '1 = the built-in Gallery category; NULL for every other' AFTER company_id`
        );
        console.log('Added is_default.');
    }

    // Adopt a host-made "Gallery" (lowest id per event) as the default.
    const [adopt] = await conn.query(
        `UPDATE event_gallery_categories c
           JOIN (SELECT MIN(id) id FROM event_gallery_categories
                  WHERE name = 'Gallery' AND deleted_at IS NULL GROUP BY event_id) m ON m.id = c.id
            SET c.is_default = 1
          WHERE c.is_default IS NULL
            AND NOT EXISTS (SELECT 1 FROM (SELECT event_id FROM event_gallery_categories
                             WHERE is_default = 1) d WHERE d.event_id = c.event_id)`
    );
    console.log(`Adopted existing "Gallery" categories: ${adopt.affectedRows}`);

    if (!idx.n) {
        await conn.query(
            `ALTER TABLE event_gallery_categories
               ADD UNIQUE KEY uq_gallery_cat_default (event_id, is_default)`
        );
        console.log('Added unique key.');
    }

    const [made] = await conn.query(
        `INSERT INTO event_gallery_categories
                (event_id, website_client_id, name, sort_order, company_id, is_default)
         SELECT e.id, e.website_client_id, 'Gallery', 0, e.company_id, 1
           FROM events e
          WHERE e.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM event_gallery_categories c
                             WHERE c.event_id = e.id AND c.is_default = 1)`
    );
    console.log(`Created Gallery categories: ${made.affectedRows}`);

    const [moved] = await conn.query(
        `UPDATE event_gallery_items i
           JOIN event_gallery_categories c ON c.event_id = i.event_id AND c.is_default = 1
            SET i.category_id = c.id
          WHERE i.category_id IS NULL`
    );
    console.log(`Photos moved into Gallery: ${moved.affectedRows}`);

    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
