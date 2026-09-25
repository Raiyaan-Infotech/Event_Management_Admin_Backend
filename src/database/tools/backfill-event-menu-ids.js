/**
 * Writes the menus an event used to get IMPLICITLY into its `menu_ids`.
 *
 * Until 2026-09-25 three slug lists (utils/menuPlacement.js, now removed) kept
 * app features and portal sections OUT of `menu_ids`: an event showed every one
 * its owner's plan granted, minus the app features in `disabled_app_menu_ids`.
 * Now every menu is an ordinary event menu and an event shows `menu_ids` plus
 * the Default menus — so an existing event would lose its implied Add-ons
 * (Invite & Share, Social Wall, Messages) the moment the new code deploys.
 *
 * For each live event: add the owner-plan-granted menus that were implied
 * (the frozen lists below), minus the ones the event had switched off. Additive
 * only — never removes an id. Default menus are added too; harmless, they show
 * regardless.
 *
 * All reads are 4 queries and all writes ONE statement (production is ~370ms a
 * query), inside a transaction. A JSON backup of every changed row is written
 * first.
 *
 *   node src/database/tools/backfill-event-menu-ids.js                 (dry run, local)
 *   node src/database/tools/backfill-event-menu-ids.js --apply
 *   node src/database/tools/backfill-event-menu-ids.js --prod           (dry run, production)
 *   node src/database/tools/backfill-event-menu-ids.js --prod --apply
 *
 * Run AFTER the new code is deployed: old code still reads the lists, and to it
 * an app feature in `menu_ids` is simply ignored — so running it first is also
 * safe, just not needed.
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const BACKUP_DIR = 'D:\\Jamal\\prod-backups';

// Frozen copies of the removed APP_FEATURE_SLUGS + PORTAL_SECTION_SLUGS.
const IMPLIED_SLUGS = [
    'participants', 'family', 'wishes', 'near-by', 'downloads', 'chat',
    'invite-share', 'social-wall',
    'guests', 'messages', 'splash-screens',
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

const idsOf = (value) => {
    let v = value;
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { v = []; }
    }
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
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
        `SELECT id, slug FROM event_menus WHERE slug IN (?) AND deleted_at IS NULL`,
        [IMPLIED_SLUGS],
    );
    const slugById = new Map(menus.map((m) => [Number(m.id), m.slug]));

    const [grants] = await conn.query(
        `SELECT plan_id, menu_id FROM subscription_plan_menus WHERE menu_id IN (?)`,
        [menus.length ? menus.map((m) => m.id) : [0]],
    );
    const grantedByPlan = new Map();
    for (const g of grants) {
        if (!grantedByPlan.has(g.plan_id)) grantedByPlan.set(g.plan_id, []);
        grantedByPlan.get(g.plan_id).push(Number(g.menu_id));
    }

    const [events] = await conn.query(
        `SELECT e.id, e.name, e.menu_ids, e.disabled_app_menu_ids, c.subscription_plan_id AS plan_id
           FROM events e
           JOIN website_clients c ON c.id = e.website_client_id
          WHERE e.deleted_at IS NULL`,
    );

    const changes = [];
    for (const e of events) {
        const current = idsOf(e.menu_ids);
        const off = new Set(idsOf(e.disabled_app_menu_ids));
        const add = (grantedByPlan.get(e.plan_id) || [])
            .filter((id) => !off.has(id) && !current.includes(id));
        if (!add.length) continue;
        changes.push({ id: e.id, before: current, after: [...current, ...add] });
        console.log(`  #${String(e.id).padEnd(5)} ${String(e.name).slice(0, 28).padEnd(28)} + ${add.map((id) => slugById.get(id)).join(', ')}`);
    }

    console.log(`\n${changes.length} of ${events.length} events change.`);

    if (!APPLY || !changes.length) {
        if (!APPLY) console.log('Dry run — nothing written. Add --apply to write.');
        await conn.end();
        return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-event-menu-ids-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(changes.map(({ id, before }) => ({ id, menu_ids: before })), null, 2));
    console.log(`Backup: ${backup}`);

    // ONE UPDATE: CASE per id.
    const cases = changes.map(() => 'WHEN ? THEN ?').join(' ');
    const params = changes.flatMap((c) => [c.id, JSON.stringify(c.after)]);
    await conn.beginTransaction();
    try {
        await conn.query(
            `UPDATE events SET menu_ids = CASE id ${cases} END WHERE id IN (?)`,
            [...params, changes.map((c) => c.id)],
        );
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    }
    console.log(`Updated ${changes.length} events.`);
    await conn.end();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
