/**
 * Menu renames (Jamal, 2026-10-22), applied as DATA in Menu Management
 * (`event_menus.name`) so the app, the client portal and the admin all show
 * the new names at once. Slugs are NOT touched — code keys on the slug.
 *
 *   event-invitation  "Event Invitation" → "Invitation"
 *   invite-share      "Invite & Share"   → "Share It"
 *
 * One UPDATE per menu inside a transaction, after a JSON backup of the rows.
 *
 *   node src/database/tools/rename-event-menus.js                 (dry run, local)
 *   node src/database/tools/rename-event-menus.js --apply
 *   node src/database/tools/rename-event-menus.js --prod          (dry run, production)
 *   node src/database/tools/rename-event-menus.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const BACKUP_DIR = 'D:\\Jamal\\prod-backups';

const RENAMES = {
    'event-invitation': 'Invitation',
    'invite-share': 'Share It',
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
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });
    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}  ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

    const [rows] = await conn.query(
        'SELECT id, name, slug FROM event_menus WHERE slug IN (?) AND deleted_at IS NULL',
        [Object.keys(RENAMES)],
    );
    const changes = rows.filter((r) => r.name !== RENAMES[r.slug]);
    for (const slug of Object.keys(RENAMES)) {
        const r = rows.find((x) => x.slug === slug);
        if (!r) console.log(`  !  ${slug}: not found`);
        else if (r.name === RENAMES[slug]) console.log(`  =  #${r.id} ${slug}: already "${r.name}"`);
        else console.log(`  →  #${r.id} ${slug}: "${r.name}" → "${RENAMES[slug]}"`);
    }
    console.log(`\n${changes.length} menu(s) to rename.`);

    if (!APPLY || !changes.length) {
        if (!APPLY) console.log('Dry run — nothing written. Add --apply to write.');
        await conn.end();
        return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-menu-renames-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(changes, null, 2));
    console.log(`Backup: ${backup}`);

    await conn.beginTransaction();
    try {
        for (const r of changes) {
            await conn.query('UPDATE event_menus SET name = ?, updated_at = NOW() WHERE id = ?', [RENAMES[r.slug], r.id]);
        }
        await conn.commit();
        console.log('Applied.');
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
