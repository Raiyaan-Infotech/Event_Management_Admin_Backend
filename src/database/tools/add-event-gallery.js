/**
 * Creates `event_gallery_items` — the first REAL event gallery.
 *
 * WHY: the app's gallery screen has always been a mock (hardcoded counts over
 * stock photos), so `max_photos`, `max_videos` and `storage_limit` were stored
 * on every plan and enforced by nothing. This is the table those limits count.
 *
 * Videos and the uploader are in the schema from the start even though the app
 * ships images first — so phase 3 needs no second migration.
 *
 *   node src/database/tools/add-event-gallery.js            (dry run, local)
 *   node src/database/tools/add-event-gallery.js --apply
 *   node src/database/tools/add-event-gallery.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const DDL = `
CREATE TABLE IF NOT EXISTS \`event_gallery_items\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`event_id\` int unsigned NOT NULL,
  \`website_client_id\` int unsigned NOT NULL COMMENT 'owner, denormalised so storage is summed per account without joining events',
  \`type\` enum('image','video') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'image',
  \`url\` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`thumbnail_url\` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'video poster; NULL for images',
  \`file_name\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`mime_type\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`size_bytes\` bigint unsigned NOT NULL DEFAULT '0' COMMENT 'counted against the plan storage limit',
  \`caption\` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`sort_order\` int NOT NULL DEFAULT '0',
  \`uploaded_by\` int unsigned DEFAULT NULL COMMENT 'website_clients.id — the host today, a guest when guest uploads land',
  \`company_id\` int unsigned DEFAULT NULL,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`deleted_at\` datetime DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_gallery_event\` (\`event_id\`,\`deleted_at\`,\`sort_order\`),
  KEY \`idx_gallery_client_type\` (\`website_client_id\`,\`type\`,\`deleted_at\`),
  CONSTRAINT \`fk_event_gallery_event\` FOREIGN KEY (\`event_id\`) REFERENCES \`events\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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

    const [[exists]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_gallery_items'`
    );
    if (exists.n) {
        const [[rows]] = await conn.query('SELECT COUNT(*) n FROM event_gallery_items');
        console.log(`Nothing to do — table already present (${rows.n} rows).`);
        await conn.end();
        return;
    }

    console.log('event_gallery_items: to be created (FK to events, ON DELETE CASCADE).');
    if (!APPLY) {
        console.log('\nDry run — nothing created. Re-run with --apply.');
        await conn.end();
        return;
    }

    await conn.query(DDL);
    console.log('Created event_gallery_items.');
    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
