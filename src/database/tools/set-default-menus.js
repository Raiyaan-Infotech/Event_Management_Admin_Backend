/**
 * Jamal's menu decision of 2026-09-25 (session §591), applied as DATA:
 *
 *   Default (locked on every plan and every event): the seven below.
 *   Everything else: Add-on (optional per plan, switchable per event).
 *   Social Wall: set Inactive — off every menu, kept for a possible return.
 *                The app's screen for it is untouched.
 *
 * Since §590 nothing in code names these menus; `is_default` is the rule. This
 * tool only writes the flags, `menu_group` to match (Core / Add-on label), and
 * grants each Default menu to every live plan that lacks it — the same thing
 * ticking Default in Menu Management does.
 *
 * Every write is one statement (production is ~370ms a query), inside a
 * transaction, after a JSON backup of the rows it changes.
 *
 *   node src/database/tools/set-default-menus.js                 (dry run, local)
 *   node src/database/tools/set-default-menus.js --apply
 *   node src/database/tools/set-default-menus.js --prod          (dry run, production)
 *   node src/database/tools/set-default-menus.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const BACKUP_DIR = 'D:\\Jamal\\prod-backups';

const DEFAULT_SLUGS = [
    'splash-screens', 'event-invitation', 'participants', 'venue', 'rsvp', 'agenda', 'guests',
];
const INACTIVE_SLUGS = ['social-wall'];

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

    const [menus] = await conn.query(
        `SELECT id, name, slug, is_default, is_active, menu_group FROM event_menus
          WHERE deleted_at IS NULL ORDER BY sort_order, id`,
    );

    const missing = DEFAULT_SLUGS.filter((s) => !menus.some((m) => m.slug === s));
    if (missing.length) console.log(`⚠ NOT ON THIS DATABASE: ${missing.join(', ')}\n`);

    const changes = [];
    for (const m of menus) {
        const isDefault = DEFAULT_SLUGS.includes(m.slug) ? 1 : 0;
        const isActive = INACTIVE_SLUGS.includes(m.slug) ? 0 : Number(m.is_active);
        const group = isDefault ? 'core' : 'addon';
        const diff = [];
        if (Number(m.is_default) !== isDefault) diff.push(`${isDefault ? 'Add-on -> DEFAULT' : 'Default -> add-on'}`);
        if (Number(m.is_active) !== isActive) diff.push('Active -> INACTIVE');
        if (m.menu_group !== group) diff.push(`group ${m.menu_group} -> ${group}`);
        console.log(`  ${String(m.slug).padEnd(20)} ${isDefault ? 'DEFAULT' : 'add-on '} ${isActive ? '' : 'INACTIVE '}${diff.length ? ' <- ' + diff.join(', ') : ''}`);
        if (diff.length) changes.push({ ...m, next: { is_default: isDefault, is_active: isActive, menu_group: group } });
    }

    const defaultIds = menus.filter((m) => DEFAULT_SLUGS.includes(m.slug)).map((m) => m.id);
    const [plans] = await conn.query(`SELECT id, name FROM subscription_plans WHERE deleted_at IS NULL ORDER BY id`);
    const [grants] = await conn.query(
        `SELECT plan_id, menu_id FROM subscription_plan_menus WHERE menu_id IN (?)`,
        [defaultIds.length ? defaultIds : [0]],
    );
    const has = new Set(grants.map((g) => `${g.plan_id}:${g.menu_id}`));
    const toGrant = [];
    for (const p of plans) {
        const lack = menus.filter((m) => defaultIds.includes(m.id) && !has.has(`${p.id}:${m.id}`));
        if (lack.length) {
            console.log(`  plan #${p.id} ${String(p.name).padEnd(14)} + ${lack.map((m) => m.slug).join(', ')}`);
            lack.forEach((m) => toGrant.push([p.id, m.id]));
        }
    }

    console.log(`\n${changes.length} menus change, ${toGrant.length} plan grants to add.`);
    if (!APPLY || (!changes.length && !toGrant.length)) {
        if (!APPLY) console.log('Dry run — nothing written. Add --apply to write.');
        await conn.end();
        return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-default-menus-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(
        changes.map(({ id, slug, is_default, is_active, menu_group }) => ({ id, slug, is_default, is_active, menu_group })),
        null, 2,
    ));
    console.log(`Backup: ${backup}`);

    await conn.beginTransaction();
    try {
        if (changes.length) {
            const col = (key) => `${key} = CASE id ${changes.map(() => 'WHEN ? THEN ?').join(' ')} END`;
            const vals = (key) => changes.flatMap((c) => [c.id, c.next[key]]);
            await conn.query(
                `UPDATE event_menus SET ${col('is_default')}, ${col('is_active')}, ${col('menu_group')}
                  WHERE id IN (?)`,
                [...vals('is_default'), ...vals('is_active'), ...vals('menu_group'), changes.map((c) => c.id)],
            );
        }
        if (toGrant.length) {
            await conn.query(
                `INSERT INTO subscription_plan_menus (plan_id, menu_id, sort_order, created_at, updated_at) VALUES ?`,
                [toGrant.map(([planId, menuId]) => [planId, menuId, 999, new Date(), new Date()])],
            );
        }
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    }
    console.log('Done. The server picks it up within a minute (plan-grant cache).');
    await conn.end();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
