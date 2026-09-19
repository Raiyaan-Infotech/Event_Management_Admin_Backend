#!/usr/bin/env node
/**
 * Hard-deletes ONE event menu by slug, with its plan grants and every
 * events / plan_types menu_ids reference to it.
 *
 * First used for `analytics`: the client-portal Analytics page is now always
 * shown (lib/navigation.ts has no `section` on it), so it is no longer a plan
 * menu. Backup first; dry-run by default.
 *
 *   node src/database/tools/remove-event-menu.js --slug analytics
 *   node src/database/tools/remove-event-menu.js --slug analytics --apply
 *   node src/database/tools/remove-event-menu.js --slug analytics --prod --apply
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
const SLUG = args[args.indexOf('--slug') + 1];
if (!args.includes('--slug') || !SLUG || SLUG.startsWith('--')) {
    console.error('Usage: --slug <menu-slug> [--apply] [--prod]');
    process.exit(1);
}
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', '..', 'prod-backups');

const parseIds = (raw) => {
    if (raw === null || raw === undefined) return null;
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(Number) : null;
};

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        charset: 'utf8mb4', ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const q = async (sql, p) => (await conn.query(sql, p))[0];
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        const menus = await q('SELECT * FROM event_menus WHERE slug = ?', [SLUG]);
        if (!menus.length) { console.log(`  = no menu with slug "${SLUG}" — nothing to do`); return; }
        const ids = menus.map((m) => m.id);
        const grants = await q('SELECT * FROM subscription_plan_menus WHERE menu_id IN (?)', [ids]);
        const strip = async (table) => (await q(`SELECT id, menu_ids FROM ${table} WHERE menu_ids IS NOT NULL`))
            .map((r) => ({ id: r.id, before: parseIds(r.menu_ids) }))
            .filter((r) => r.before && r.before.some((id) => ids.includes(id)))
            .map((r) => ({ ...r, after: r.before.filter((id) => !ids.includes(id)) }));
        const events = await strip('events');
        const planTypes = await strip('plan_types');

        console.log(`  - menu      ${menus.map((m) => `#${m.id} ${m.name}`).join(', ')}`);
        console.log(`  - grants    ${grants.length} (plans ${[...new Set(grants.map((g) => g.plan_id))].join(', ') || '—'})`);
        console.log(`  - menu_ids  ${events.length} event(s), ${planTypes.length} plan type(s)`);
        if (!APPLY) { console.log('\nDry run — nothing written.'); return; }

        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const file = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-remove-menu-${SLUG}-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify({ menus, grants, events, planTypes }, null, 2));
        console.log(`\n  backup: ${file}`);

        await conn.beginTransaction();
        try {
            await q('DELETE FROM subscription_plan_menus WHERE menu_id IN (?)', [ids]);
            for (const [table, fixes] of [['events', events], ['plan_types', planTypes]]) {
                for (const f of fixes) {
                    await q(`UPDATE ${table} SET menu_ids = CAST(? AS JSON) WHERE id = ?`, [JSON.stringify(f.after), f.id]);
                }
            }
            await q('DELETE FROM event_menus WHERE id IN (?)', [ids]);
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        }
        console.log('  applied.');
    } finally {
        await conn.end();
    }
})().catch((err) => { console.error(`\nFAILED: ${err.message}`); process.exit(1); });
