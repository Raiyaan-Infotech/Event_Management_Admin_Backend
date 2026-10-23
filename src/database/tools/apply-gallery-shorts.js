/**
 * Shorts in the event gallery (Jamal, 2026-10-23): four columns on
 * `event_gallery_items`. A short IS a gallery video (type 'video' — it counts
 * against the plan's video limit and storage like any video), marked
 * `is_short = 1`, with its own title / description and its length.
 *
 * All four are optional with safe defaults, so every existing row reads as a
 * plain photo / video exactly as today. Run this BEFORE deploying the code
 * that reads them (Sequelize selects every model column).
 *
 *   node src/database/tools/apply-gallery-shorts.js                 (dry run, local)
 *   node src/database/tools/apply-gallery-shorts.js --apply
 *   node src/database/tools/apply-gallery-shorts.js --prod          (dry run, production)
 *   node src/database/tools/apply-gallery-shorts.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

// In order, each AFTER the one before it.
const COLUMNS = [
    ['is_short', "tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = a Short (vertical clip, max 1 minute)'", 'type'],
    ['title', 'varchar(150) DEFAULT NULL COMMENT \'A short\'\'s title\'', 'is_short'],
    ['description', 'varchar(500) DEFAULT NULL', 'title'],
    ['duration_seconds', 'smallint unsigned DEFAULT NULL COMMENT \'A short\'\'s length\'', 'description'],
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
    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}  ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

    const [rows] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_gallery_items'`
    );
    const have = new Set(rows.map((r) => r.COLUMN_NAME));
    const todo = COLUMNS.filter(([name]) => !have.has(name));
    for (const [name] of COLUMNS) console.log(`  event_gallery_items.${name}: ${have.has(name) ? 'present' : 'TO ADD'}`);

    if (!todo.length) {
        console.log('\nNothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    // One ALTER for all of them — one round trip, one table rebuild.
    const ddl = `ALTER TABLE \`event_gallery_items\`\n  ${todo
        .map(([name, def, after]) => `ADD COLUMN \`${name}\` ${def} AFTER \`${after}\``)
        .join(',\n  ')}`;
    await conn.query(ddl);
    console.log(`\nAdded ${todo.map(([n]) => n).join(', ')}.`);
    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
