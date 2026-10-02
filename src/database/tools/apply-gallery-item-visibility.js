/**
 * Adds `show_in_app` to `event_gallery_items`.
 *
 * WHY: Edit Media's "Show in Event App" switch (Jamal's "Gallery Media
 * Management" design). The host keeps a photo in the gallery but hides it from
 * the guests. Default 1 — every existing photo stays visible, exactly as it is
 * today. This is a per-PHOTO flag; whether the Gallery MENU shows at all is
 * still the event's `menu_ids`, not a column.
 *
 *   node src/database/tools/apply-gallery-item-visibility.js            (dry run, local)
 *   node src/database/tools/apply-gallery-item-visibility.js --apply
 *   node src/database/tools/apply-gallery-item-visibility.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const DDL = `
ALTER TABLE \`event_gallery_items\`
  ADD COLUMN \`show_in_app\` tinyint(1) NOT NULL DEFAULT '1' COMMENT '0 = hidden from guests, the host still sees it' AFTER \`caption\`;
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

    const [[column]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_gallery_items'
            AND COLUMN_NAME = 'show_in_app'`
    );
    console.log(`event_gallery_items.show_in_app: ${column.n ? 'present' : 'TO ADD'}`);

    if (column.n) {
        console.log('Nothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    await conn.query(DDL);
    console.log('Added event_gallery_items.show_in_app.');

    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
