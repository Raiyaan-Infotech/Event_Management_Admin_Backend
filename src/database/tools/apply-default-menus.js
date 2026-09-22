#!/usr/bin/env node
/**
 * Default menus vs add-on features (session §548).
 *
 *   1. Adds `event_menus.is_default` (1 = a new plan starts with it ticked,
 *      0 = an add-on feature). The code reads only this flag — nothing counts
 *      or lists the defaults.
 *   2. Creates the "Event Invitation" menu (slug `event-invitation`, core) if it
 *      is not there yet, in the same category and company as Event Information.
 *   3. Marks the menus in DEFAULT_SLUGS as default (Jamal's list). Everything
 *      else stays an add-on. After this, defaults are changed in Menu
 *      Management, not here.
 *   4. Grants every default menu to every live plan that does not have it yet
 *      ("default for all plans"); nothing is ever removed from a plan.
 *
 * Safe before deploying the new code: the old model never selects is_default.
 * The new Event Invitation menu is live for plans as soon as it is granted.
 *
 *   node src/database/tools/apply-default-menus.js                 dry run, local
 *   node src/database/tools/apply-default-menus.js --apply         local
 *   node src/database/tools/apply-default-menus.js --prod          dry run, production
 *   node src/database/tools/apply-default-menus.js --prod --apply  production
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', '..', 'prod-backups');

// Jamal's default list, 2026-09-22. One-off data for this migration only.
const DEFAULT_SLUGS = [
    'event-invitation', 'rsvp', 'agenda', 'participants', 'event-information', 'venue',
    'gallery', 'family', 'wishes', 'contact-us', 'near-by', 'downloads', 'chat',
];

const NEW_MENU = {
    name: 'Event Invitation',
    slug: 'event-invitation',
    description: 'The event\'s invitation card — the design chosen when the event was created.',
    menu_group: 'core',
    icon: 'mdi:email-open-outline',
    color: '#DB2777',
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
        const hasFlag = (await q(
            `SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'event_menus' AND COLUMN_NAME = 'is_default'`
        )).length > 0;
        console.log(`  - is_default column: ${hasFlag ? 'present' : 'WILL ADD'}`);

        const menus = await q(`SELECT id, name, slug, menu_group, event_category_id, company_id, sort_order${hasFlag ? ', is_default' : ''}
                                 FROM event_menus WHERE deleted_at IS NULL ORDER BY sort_order, id`);
        const bySlug = new Map(menus.map((m) => [m.slug, m]));
        const info = bySlug.get('event-information');
        const needsMenu = !bySlug.has(NEW_MENU.slug);
        if (needsMenu && !info) throw new Error('No event-information menu to take the category / company from.');
        console.log(`  - Event Invitation menu: ${needsMenu ? 'WILL CREATE (core, category #' + info.event_category_id + ')' : 'exists (#' + bySlug.get(NEW_MENU.slug).id + ')'}`);

        const missingSlugs = DEFAULT_SLUGS.filter((s) => !bySlug.has(s) && s !== NEW_MENU.slug);
        if (missingSlugs.length) console.log(`  ! default slugs with no live menu (skipped): ${missingSlugs.join(', ')}`);
        const defaultMenus = DEFAULT_SLUGS.map((s) => bySlug.get(s)).filter(Boolean);
        const addOns = menus.filter((m) => !DEFAULT_SLUGS.includes(m.slug));
        console.log(`  - defaults: ${DEFAULT_SLUGS.filter((s) => bySlug.has(s) || s === NEW_MENU.slug).join(', ')}`);
        console.log(`  - add-on features: ${addOns.map((m) => m.slug).join(', ') || '(none)'}`);

        const plans = await q('SELECT id, name FROM subscription_plans WHERE deleted_at IS NULL ORDER BY id');
        const grants = await q('SELECT plan_id, menu_id, sort_order FROM subscription_plan_menus');
        const toGrant = [];
        for (const p of plans) {
            const mine = grants.filter((g) => g.plan_id === p.id);
            const have = new Set(mine.map((g) => g.menu_id));
            let next = mine.reduce((m, g) => Math.max(m, g.sort_order), -1) + 1;
            const adds = defaultMenus.filter((m) => !have.has(m.id)).map((m) => ({ planId: p.id, menuId: m.id, slug: m.slug, sort: next++ }));
            if (needsMenu) adds.push({ planId: p.id, menuId: null, slug: NEW_MENU.slug, sort: next++ });
            if (adds.length) console.log(`  + plan #${p.id} ${p.name}: gains ${adds.map((a) => a.slug).join(', ')}`);
            toGrant.push(...adds);
        }
        if (!toGrant.length) console.log('  = every plan already has every default menu');

        if (!APPLY) { console.log('\nDry run — nothing written.'); return; }

        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const file = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-default-menus-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify({ menus, grants }, null, 2));
        console.log(`\n  backup: ${file}`);

        if (!hasFlag) {
            await q(`ALTER TABLE event_menus ADD COLUMN \`is_default\` tinyint NOT NULL DEFAULT '0'
                     COMMENT '1 = new plans start with it ticked; 0 = add-on feature' AFTER \`active_mobile\``);
            console.log('  + event_menus: added is_default');
        }

        await conn.beginTransaction();
        try {
            let newId = null;
            if (needsMenu) {
                const minSort = menus.reduce((m, x) => Math.min(m, x.sort_order), 1);
                const ins = await q(
                    `INSERT INTO event_menus (name, slug, description, menu_group, event_category_id,
                        active_website, active_mobile, is_default, icon, color, sort_order, is_active, company_id,
                        created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?, 1, ?, NOW(), NOW())`,
                    [NEW_MENU.name, NEW_MENU.slug, NEW_MENU.description, NEW_MENU.menu_group,
                        info.event_category_id, NEW_MENU.icon, NEW_MENU.color, minSort - 1, info.company_id]
                );
                newId = ins.insertId;
                console.log(`  + created Event Invitation (#${newId})`);
            }
            await q('UPDATE event_menus SET is_default = CASE WHEN slug IN (?) THEN 1 ELSE 0 END WHERE deleted_at IS NULL', [DEFAULT_SLUGS]);
            console.log('  + default flags set');
            if (toGrant.length) {
                await q(
                    `INSERT IGNORE INTO subscription_plan_menus (plan_id, menu_id, sort_order, created_at, updated_at) VALUES ?`,
                    [toGrant.map((g) => [g.planId, g.menuId ?? newId, g.sort, new Date(), new Date()])]
                );
                console.log(`  + ${toGrant.length} grant(s) added`);
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        }
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
