/**
 * Adds `primary_font_size`, `secondary_font_size`, `frame_color` and
 * `decoration_color` to `event_templates`.
 *
 * WHY: the template wizard's Step 2 gained a size beside each font and a
 * Border Color (Jamal, 2026-10-06). The sizes are a percentage of the
 * renderer's standard size (100 = unchanged; the Primary Font draws the names,
 * the Secondary Font every other line). `frame_color` draws the chosen frame
 * in one colour; null leaves the frame the colours it was uploaded with.
 *
 *   node src/database/tools/apply-event-template-typography.js            (dry run, local)
 *   node src/database/tools/apply-event-template-typography.js --apply
 *   node src/database/tools/apply-event-template-typography.js --prod --apply
 *
 * ⚠ Run on production BEFORE deploying the backend that reads the columns:
 * the EventTemplate model selects them, so every template query — the admin
 * list, and a client's event options — fails until they exist.
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

/** column -> the clause that adds it. Each is added only if missing. */
const COLUMNS = {
    primary_font_size:
        "ADD COLUMN `primary_font_size` smallint unsigned NOT NULL DEFAULT '100' COMMENT 'Size of the names, as a percentage of the standard size' AFTER `secondary_font`",
    secondary_font_size:
        "ADD COLUMN `secondary_font_size` smallint unsigned NOT NULL DEFAULT '100' COMMENT 'Size of every other line, as a percentage of the standard size' AFTER `primary_font_size`",
    frame_color:
        "ADD COLUMN `frame_color` varchar(9) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Draw the frame in this one colour; null = the frame''s own colours' AFTER `frame_style_id`",
    // Added the same day as the three above, for the Decoration Color field.
    decoration_color:
        "ADD COLUMN `decoration_color` varchar(9) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Draw the decorations in this one colour; null = their own colours' AFTER `frame_color`",
};

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

    const [present] = await conn.query(
        `SELECT COLUMN_NAME c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_templates'
            AND COLUMN_NAME IN (?)`,
        [Object.keys(COLUMNS)]
    );
    const have = new Set(present.map((r) => r.c));
    const missing = Object.keys(COLUMNS).filter((c) => !have.has(c));
    for (const c of Object.keys(COLUMNS)) console.log(`event_templates.${c}: ${have.has(c) ? 'present' : 'TO ADD'}`);

    if (missing.length === 0) {
        console.log('Nothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    // One ALTER, in the order above, so `AFTER primary_font_size` finds it.
    await conn.query(`ALTER TABLE \`event_templates\` ${missing.map((c) => COLUMNS[c]).join(', ')}`);
    console.log(`Added: ${missing.join(', ')}.`);
    await conn.end();
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
