/**
 * Makes the data agree with the locked-menu rule.
 *
 * The plan wizard and Menu Management show seven menus ticked and disabled
 * (utils/menuPlacement LOCKED_MENU_SLUGS) — every plan grants them and nobody
 * can turn them off. The data never got the memo: `guests` and `splash-screens`
 * were still `is_default = 0`, and Free granted neither, so a Free client's
 * portal had no Guests section at all.
 *
 * Two things, both additive — it never removes a grant or unsets a flag:
 *   1. is_default = 1 for every locked menu
 *   2. a plan_menu row for every (live plan × locked menu) pair that lacks one
 *
 *   node src/database/tools/align-locked-menus.js            (dry run, local)
 *   node src/database/tools/align-locked-menus.js --apply
 *   node src/database/tools/align-locked-menus.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const BACKUP_DIR = 'D:\\Jamal\\prod-backups';

const { LOCKED_MENU_SLUGS } = require('../../utils/menuPlacement');

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

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}\n`);

    const [menus] = await conn.query(
        `SELECT id, name, slug, is_default FROM event_menus WHERE slug IN (?) AND deleted_at IS NULL`,
        [LOCKED_MENU_SLUGS]
    );
    const missingSlugs = LOCKED_MENU_SLUGS.filter((s) => !menus.some((m) => m.slug === s));
    if (missingSlugs.length) console.log(`NOT ON THIS DATABASE (skipped): ${missingSlugs.join(', ')}`);

    const toFlag = menus.filter((m) => Number(m.is_default) !== 1);
    console.log(`is_default -> 1 for: ${toFlag.length ? toFlag.map((m) => m.slug).join(', ') : '(none, all set)'}`);

    const [plans] = await conn.query(
        `SELECT id, name FROM subscription_plans WHERE deleted_at IS NULL ORDER BY id`
    );
    const [grants] = await conn.query(
        `SELECT plan_id, menu_id FROM subscription_plan_menus WHERE menu_id IN (?)`,
        [menus.map((m) => m.id)]
    );
    const has = new Set(grants.map((g) => `${g.plan_id}:${g.menu_id}`));

    const toGrant = [];
    for (const plan of plans) {
        const missing = menus.filter((m) => !has.has(`${plan.id}:${m.id}`));
        if (missing.length) {
            console.log(`  plan #${plan.id} ${String(plan.name).padEnd(12)} + ${missing.map((m) => m.slug).join(', ')}`);
            missing.forEach((m) => toGrant.push({ plan_id: plan.id, menu_id: m.id }));
        }
    }
    console.log(`\ngrants to add: ${toGrant.length}`);

    if (!toFlag.length && !toGrant.length) {
        console.log('Nothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('Dry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-align-locked-menus-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify({ menus, grants }, null, 2));
    console.log(`Backup: ${backup}`);

    if (toFlag.length) {
        await conn.query(`UPDATE event_menus SET is_default = 1 WHERE id IN (?)`, [toFlag.map((m) => m.id)]);
        console.log(`flagged ${toFlag.length} menus as default`);
    }
    if (toGrant.length) {
        await conn.query(
            `INSERT IGNORE INTO subscription_plan_menus (plan_id, menu_id, sort_order, created_at, updated_at)
             VALUES ${toGrant.map(() => '(?, ?, 0, NOW(), NOW())').join(', ')}`,
            toGrant.flatMap((g) => [g.plan_id, g.menu_id])
        );
        console.log(`added ${toGrant.length} plan grants`);
    }

    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
