/**
 * Adds `custom_image` to `events`.
 *
 * WHY: a CUSTOM-type invitation template (its `background_type` is `custom`)
 * is a design masked to a shape. When a host picks one, the app and the client
 * portal now ask for the host's OWN picture to put in that shape (Jamal,
 * 2026-10-05). It belongs to the event, not the template: two events on the
 * same template each have their own. Null = the template's own picture.
 *
 *   node src/database/tools/apply-event-custom-image.js            (dry run, local)
 *   node src/database/tools/apply-event-custom-image.js --apply
 *   node src/database/tools/apply-event-custom-image.js --prod --apply
 *
 * ⚠ Run on production BEFORE deploying the backend that reads the column: the
 * Event model selects it, so every event query fails until it exists.
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const DDL = `
ALTER TABLE \`events\`
  ADD COLUMN \`custom_image\` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'The host''s own picture for a custom-type template; null = the template''s own' AFTER \`organizer_image\`;
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
        ssl: PROD && env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : undefined,
    });

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}`);

    const [[column]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
            AND COLUMN_NAME = 'custom_image'`
    );
    console.log(`events.custom_image: ${column.n ? 'present' : 'TO ADD'}`);

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
    console.log('events.custom_image added.');
    await conn.end();
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
