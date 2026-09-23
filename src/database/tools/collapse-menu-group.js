/**
 * Collapses `event_menus.menu_group` to two values: 'core' and 'addon'.
 *
 * WHY: the group used to decide WHERE a menu appears ('app' = mobile tile,
 * 'portal' = portal sidebar section), which made placement an editable dropdown
 * — an admin could move "Guests" into the event wizard by accident. Placement is
 * a property of the feature, so it moved to `utils/menuPlacement.js` (slug
 * lists), and the group is now just a Core / Add-on label.
 *
 * Mapping: the existing Default/Add-on decision already lives in `is_default`,
 * so the label follows it — is_default = 1 -> 'core', 0 -> 'addon'. The old
 * 'app' / 'portal' values carry no information that menuPlacement does not.
 *
 *   node src/database/tools/collapse-menu-group.js            (dry run, local)
 *   node src/database/tools/collapse-menu-group.js --apply
 *   node src/database/tools/collapse-menu-group.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const NEW_TYPE = "enum('core','addon')";
const BACKUP_DIR = 'D:\\Jamal\\prod-backups';

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

    const [[col]] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='event_menus' AND COLUMN_NAME='menu_group'`
    );
    console.log(`current: ${col.COLUMN_TYPE}`);
    console.log(`target : ${NEW_TYPE}`);

    const [rows] = await conn.query(
        `SELECT id, slug, menu_group, is_default FROM event_menus ORDER BY sort_order, id`
    );
    const planned = rows.map((r) => ({
        ...r,
        next: Number(r.is_default) === 1 ? 'core' : 'addon',
    }));

    console.log('\nslug'.padEnd(21) + 'now'.padEnd(10) + '->');
    planned.forEach((r) => {
        const changed = r.menu_group !== r.next ? '  (changed)' : '';
        console.log(`${String(r.slug).padEnd(20)} ${String(r.menu_group).padEnd(9)} ${r.next}${changed}`);
    });

    if (col.COLUMN_TYPE.replace(/\s/g, '') === NEW_TYPE && planned.every((r) => r.menu_group === r.next)) {
        console.log('\nNothing to do — already collapsed.');
        await conn.end();
        return;
    }

    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(
        BACKUP_DIR,
        `${PROD ? 'prod' : 'local'}-collapse-menu-group-${Date.now()}.json`
    );
    fs.writeFileSync(backup, JSON.stringify(rows, null, 2));
    console.log(`\nBackup: ${backup}`);

    // Widen first so both the old and new values are legal, then rewrite the
    // rows, then narrow. Narrowing with rows still holding 'app' would blank
    // them, which is the one outcome worth engineering around here.
    await conn.query(
        `ALTER TABLE event_menus MODIFY COLUMN \`menu_group\`
         enum('core','additional','custom','portal','app','addon')
         COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'core'`
    );
    for (const value of ['core', 'addon']) {
        const ids = planned.filter((r) => r.next === value).map((r) => r.id);
        if (!ids.length) continue;
        await conn.query('UPDATE event_menus SET menu_group = ? WHERE id IN (?)', [value, ids]);
        console.log(`${value}: ${ids.length} rows`);
    }
    await conn.query(
        `ALTER TABLE event_menus MODIFY COLUMN \`menu_group\` ${NEW_TYPE}
         COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'core'`
    );
    console.log('Collapsed to core / addon.');

    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
