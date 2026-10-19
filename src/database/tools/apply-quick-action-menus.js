#!/usr/bin/env node
/**
 * Home Quick Action menus (2026-10-19).
 *
 * 1. `event_menus.menu_group` gains a third value, `quick_action` — a menu for
 *    the app's Home Quick Actions only, never a tile inside an event (excluded
 *    by clientEvent.presentOne and clientPortal.getEventOptions).
 * 2. Adds four such menus to Menu Management — QR Code, Notifications,
 *    My Plan, My Briefcase (the old Home tiles that had no menu) — in the
 *    same category and company as the Agenda menu, Add-on (not Default).
 * 3. Grants each of them to every plan, so every organizer keeps them; the
 *    admin can untick them per plan afterwards like any add-on.
 *
 * Re-runnable: a menu whose slug already exists is left alone (not re-granted).
 * Same change as src/database/migrations/sql/20261019-quick-action-menus.sql.
 *
 *   node src/database/tools/apply-quick-action-menus.js                  dry run, local
 *   node src/database/tools/apply-quick-action-menus.js --apply          local
 *   node src/database/tools/apply-quick-action-menus.js --prod           dry run, production
 *   node src/database/tools/apply-quick-action-menus.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend whose EventMenu
 * model lists `quick_action` (harmless the other way round for reads, but a
 * save of a Quick Action menu would fail on the old ENUM).
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const MENUS = [
    { name: 'QR Code', slug: 'qr-code', icon: 'mdi:qrcode', description: 'Open the event invitation QR code.' },
    { name: 'Notifications', slug: 'notifications', icon: 'mdi:bell-outline', description: 'Create a new notification for one event.' },
    { name: 'My Plan', slug: 'my-plan', icon: 'mdi:crown-outline', description: 'Your plan limits: storage, photos, videos, guests and participants.' },
    { name: 'My Briefcase', slug: 'my-briefcase', icon: 'mdi:briefcase-outline', description: 'Your briefcase (coming soon).' },
];

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);

    try {
        // 1. The ENUM.
        const [[col]] = await conn.query(
            `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_menus' AND COLUMN_NAME = 'menu_group'`,
            [process.env.DB_NAME],
        );
        const hasEnum = String(col?.t || '').includes("'quick_action'");
        if (hasEnum) {
            console.log(`  = menu_group ENUM        already has quick_action (${col.t})`);
        } else if (!APPLY) {
            console.log(`  + menu_group ENUM        WOULD CHANGE ${col?.t} → enum('core','addon','quick_action')`);
        } else {
            await conn.query(
                "ALTER TABLE `event_menus` MODIFY `menu_group` enum('core','addon','quick_action') NOT NULL DEFAULT 'core'",
            );
            console.log('  + menu_group ENUM        now enum(core, addon, quick_action)');
        }

        // Category / company / order: the Agenda menu's, like every other menu.
        const [[anchor]] = await conn.query(
            "SELECT event_category_id, company_id FROM event_menus WHERE slug = 'agenda' AND deleted_at IS NULL ORDER BY id LIMIT 1",
        );
        const [[{ maxSort }]] = await conn.query(
            'SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM event_menus WHERE deleted_at IS NULL',
        );
        const [[{ plans }]] = await conn.query(
            'SELECT COUNT(*) AS plans FROM subscription_plans WHERE deleted_at IS NULL',
        );
        console.log(`  · category ${anchor?.event_category_id ?? 'NULL'}, company ${anchor?.company_id ?? 'NULL'}, ${plans} plan(s) to grant\n`);

        let sort = Number(maxSort) || 0;
        for (const m of MENUS) {
            const [[existing]] = await conn.query(
                'SELECT id, name, menu_group, deleted_at FROM event_menus WHERE slug = ? LIMIT 1',
                [m.slug],
            );
            if (existing) {
                console.log(`  = ${m.slug.padEnd(14)} already #${existing.id} "${existing.name}" (${existing.menu_group}${existing.deleted_at ? ', DELETED' : ''})`);
                continue;
            }
            sort += 1;
            if (!APPLY) {
                console.log(`  + ${m.slug.padEnd(14)} WOULD ADD "${m.name}" (quick_action, add-on, ${m.icon}) + grant to ${plans} plan(s)`);
                continue;
            }
            const [res] = await conn.query(
                `INSERT INTO event_menus
                    (name, slug, description, menu_group, event_category_id, is_default, icon, color,
                     sort_order, is_active, company_id, created_at, updated_at)
                 VALUES (?, ?, ?, 'quick_action', ?, 0, ?, NULL, ?, 1, ?, NOW(), NOW())`,
                [m.name, m.slug, m.description, anchor?.event_category_id ?? null, m.icon, sort, anchor?.company_id ?? null],
            );
            const menuId = res.insertId;
            const [grant] = await conn.query(
                `INSERT INTO subscription_plan_menus (plan_id, menu_id, sort_order, created_at, updated_at)
                 SELECT p.id, ?, 999, NOW(), NOW()
                   FROM subscription_plans p
                  WHERE p.deleted_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM subscription_plan_menus g
                                     WHERE g.plan_id = p.id AND g.menu_id = ?)`,
                [menuId, menuId],
            );
            console.log(`  + ${m.slug.padEnd(14)} added #${menuId} "${m.name}", granted to ${grant.affectedRows} plan(s)`);
        }
        if (!APPLY) console.log('\nRe-run with --apply to write it.');
        else console.log('\nDone. The running backend caches plan grants for a while — restart it (or wait) to see them.');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
