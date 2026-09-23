/**
 * Creates `event_gallery_categories` and adds `category_id` to gallery items.
 *
 * WHY: the app's gallery has always SHOWN categories ("Highlights 28",
 * "Ceremony 46") with nothing behind them, and an Add Category screen that
 * saved nowhere. These are per EVENT, not global — one wedding's "Mehendi" is
 * not another's.
 *
 * `category_id` is nullable and ON DELETE SET NULL: deleting a category must
 * not delete the photos in it, it just returns them to Uncategorised.
 *
 *   node src/database/tools/add-gallery-categories.js            (dry run, local)
 *   node src/database/tools/add-gallery-categories.js --apply
 *   node src/database/tools/add-gallery-categories.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS \`event_gallery_categories\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`event_id\` int unsigned NOT NULL,
  \`website_client_id\` int unsigned NOT NULL,
  \`name\` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`icon\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`sort_order\` int NOT NULL DEFAULT '0',
  \`company_id\` int unsigned DEFAULT NULL,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`deleted_at\` datetime DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_gallery_cat_event\` (\`event_id\`,\`deleted_at\`,\`sort_order\`),
  CONSTRAINT \`fk_gallery_cat_event\` FOREIGN KEY (\`event_id\`) REFERENCES \`events\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const COLUMN_DDL = `
ALTER TABLE \`event_gallery_items\`
  ADD COLUMN \`category_id\` int unsigned DEFAULT NULL COMMENT 'NULL = Uncategorised' AFTER \`type\`,
  ADD KEY \`idx_gallery_item_category\` (\`category_id\`),
  ADD CONSTRAINT \`fk_gallery_item_category\` FOREIGN KEY (\`category_id\`)
      REFERENCES \`event_gallery_categories\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;
`;

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

    const [[table]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_gallery_categories'`
    );
    const [[column]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_gallery_items'
            AND COLUMN_NAME = 'category_id'`
    );

    console.log(`event_gallery_categories: ${table.n ? 'present' : 'TO CREATE'}`);
    console.log(`event_gallery_items.category_id: ${column.n ? 'present' : 'TO ADD'}`);

    if (table.n && column.n) {
        console.log('Nothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    if (!table.n) {
        await conn.query(TABLE_DDL);
        console.log('Created event_gallery_categories.');
    }
    if (!column.n) {
        await conn.query(COLUMN_DDL);
        console.log('Added event_gallery_items.category_id.');
    }

    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
