/**
 * TEST DATA (Jamal, 2026-10-23): extra Classic → Color invitation templates,
 * so the app's Preview Invitation page has a "same style" row to swipe.
 *
 * Each one is a copy of the Classic Color template (`classic-royal-plum`) —
 * same category, layout, fonts, sections and plan rules — with its own name,
 * code and colours. Codes start with `classic-test-` so `--remove` can find
 * them again. One multi-row INSERT inside a transaction.
 *
 *   node src/database/tools/add-classic-color-test-templates.js                  (dry run, local)
 *   node src/database/tools/add-classic-color-test-templates.js --apply
 *   node src/database/tools/add-classic-color-test-templates.js --prod           (dry run, production)
 *   node src/database/tools/add-classic-color-test-templates.js --prod --apply
 *   node src/database/tools/add-classic-color-test-templates.js --prod --remove --apply   (soft-delete them)
 *   node src/database/tools/add-classic-color-test-templates.js --prod --restore --apply  (un-delete them)
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const REMOVE = process.argv.includes('--remove');
const RESTORE = process.argv.includes('--restore');

const SOURCE_CODE = 'classic-royal-plum';
const PREFIX = 'classic-test-';

// name, background colour, secondary (accent) colour
const COPIES = [
    ['Rose Blush', '#FCE7EC', '#B4235A'],
    ['Emerald Leaf', '#E6F4EC', '#1E7A4C'],
    ['Golden Sand', '#FBF3DF', '#B7791F'],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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
    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}  ${APPLY ? 'APPLY' : 'DRY RUN'}${REMOVE ? '  REMOVE' : ''}\n`);

    const [existing] = await conn.query(
        'SELECT id, code, name FROM event_templates WHERE code LIKE ? AND deleted_at IS NULL',
        [`${PREFIX}%`],
    );

    if (RESTORE) {
        const [gone] = await conn.query(
            'SELECT id, code, name FROM event_templates WHERE code LIKE ? AND deleted_at IS NOT NULL',
            [`${PREFIX}%`],
        );
        console.log(gone.length ? gone.map((r) => `  ↺ #${r.id} ${r.code} "${r.name}"`).join('\n') : '  nothing to restore');
        if (APPLY && gone.length) {
            await conn.query('UPDATE event_templates SET deleted_at = NULL WHERE id IN (?)', [gone.map((r) => r.id)]);
            console.log(`\nRestored ${gone.length}.`);
        }
        await conn.end();
        return;
    }

    if (REMOVE) {
        console.log(existing.length ? existing.map((r) => `  - #${r.id} ${r.code} "${r.name}"`).join('\n') : '  nothing to remove');
        if (APPLY && existing.length) {
            await conn.query('UPDATE event_templates SET deleted_at = NOW() WHERE id IN (?)', [existing.map((r) => r.id)]);
            console.log(`\nSoft-deleted ${existing.length}.`);
        }
        await conn.end();
        return;
    }

    const [[src]] = await conn.query(
        'SELECT * FROM event_templates WHERE code = ? AND deleted_at IS NULL LIMIT 1',
        [SOURCE_CODE],
    );
    if (!src) throw new Error(`Source template "${SOURCE_CODE}" not found — nothing to copy.`);
    console.log(`Source: #${src.id} ${src.code} "${src.name}"  category ${src.template_category_id}  type ${src.background_type}\n`);

    const have = new Set(existing.map((r) => r.code));
    const todo = COPIES.filter(([name]) => !have.has(PREFIX + slug(name)));
    for (const [name, bg, accent] of COPIES) {
        const code = PREFIX + slug(name);
        console.log(`  ${have.has(code) ? '= exists ' : '+ add    '} ${code}  "${name}"  bg ${bg}  accent ${accent}`);
    }
    if (!todo.length) {
        console.log('\nAll test templates already exist.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — add --apply to write.');
        await conn.end();
        return;
    }

    const skip = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
    const cols = Object.keys(src).filter((c) => !skip.has(c));
    const json = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v);
    const rows = todo.map(([name, bg, accent], i) => cols.map((c) => {
        if (c === 'name') return name;
        if (c === 'code') return PREFIX + slug(name);
        if (c === 'background_color') return bg;
        if (c === 'secondary_color') return accent;
        if (c === 'thumbnail') return null; // the app draws the card itself
        if (c === 'sort_order') return (src.sort_order || 0) + i + 1;
        return json(src[c]);
    }));

    await conn.beginTransaction();
    try {
        const [res] = await conn.query(
            `INSERT INTO event_templates (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES ?`,
            [rows],
        );
        await conn.commit();
        console.log(`\nInserted ${res.affectedRows} template(s), first id ${res.insertId}.`);
    } catch (e) {
        await conn.rollback();
        throw e;
    }
    await conn.end();
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
