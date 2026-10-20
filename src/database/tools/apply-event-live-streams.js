#!/usr/bin/env node
/**
 * Live Streaming (2026-10-20).
 *
 * 1. Creates `event_live_stream_types` and `event_live_streams`
 *    (src/database/migrations/sql/20261020-event-live-streams.sql).
 * 2. Adds the "Live Streaming" menu to Menu Management (slug `live-streaming`,
 *    Add-on, same category / company as the Agenda menu, placed after Wed Wishes)
 *    and grants it to every plan — the admin can untick it per plan like any add-on.
 *
 * Re-runnable: existing tables and an existing menu are left alone.
 *
 *   node src/database/tools/apply-event-live-streams.js                  dry run, local
 *   node src/database/tools/apply-event-live-streams.js --apply          local
 *   node src/database/tools/apply-event-live-streams.js --prod           dry run, production
 *   node src/database/tools/apply-event-live-streams.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend (the models read
 * these tables; Event delete purges them).
 */

require('dotenv').config();
const fs = require('fs');
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261020-event-live-streams.sql');
const TABLES = ['event_live_stream_types', 'event_live_streams'];
const MENU = {
    name: 'Live Streaming',
    slug: 'live-streaming',
    icon: 'mdi:video-wireless-outline',
    description: 'Share live stream links of your event with participants.',
};

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);

    try {
        // 1. Tables.
        const [have] = await conn.query(
            'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)',
            [process.env.DB_NAME, TABLES],
        );
        const existing = new Set(have.map((r) => r.t));
        const missing = TABLES.filter((t) => !existing.has(t));
        for (const t of TABLES) {
            if (existing.has(t)) console.log(`  = ${t.padEnd(26)} already exists`);
            else console.log(`  + ${t.padEnd(26)} ${APPLY ? 'creating' : 'WOULD CREATE'}`);
        }
        if (missing.length && APPLY) {
            const sql = fs.readFileSync(SQL_FILE, 'utf8')
                .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
                // The trailing check SELECT is for a hand run; not needed here.
                .replace(/SELECT TABLE_NAME[\s\S]*$/, '');
            await conn.query(sql);
            console.log('    tables created');
        }

        // 2. The menu.
        const [[menu]] = await conn.query(
            'SELECT id, name, deleted_at FROM event_menus WHERE slug = ? LIMIT 1', [MENU.slug],
        );
        if (menu) {
            console.log(`  = menu ${MENU.slug.padEnd(21)} already #${menu.id} "${menu.name}"${menu.deleted_at ? ' (DELETED)' : ''}`);
        } else {
            const [[anchor]] = await conn.query(
                "SELECT event_category_id, company_id FROM event_menus WHERE slug = 'agenda' AND deleted_at IS NULL ORDER BY id LIMIT 1",
            );
            // Right after Wed Wishes; everything after it moves down one.
            const [[wishes]] = await conn.query(
                "SELECT sort_order FROM event_menus WHERE slug = 'wishes' AND deleted_at IS NULL ORDER BY id LIMIT 1",
            );
            const [[{ maxSort }]] = await conn.query(
                'SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM event_menus WHERE deleted_at IS NULL',
            );
            const sort = wishes ? Number(wishes.sort_order) + 1 : Number(maxSort) + 1;
            const [[{ plans }]] = await conn.query(
                'SELECT COUNT(*) AS plans FROM subscription_plans WHERE deleted_at IS NULL',
            );
            if (!APPLY) {
                console.log(`  + menu ${MENU.slug.padEnd(21)} WOULD ADD "${MENU.name}" (add-on, ${MENU.icon}, order ${sort}) + grant to ${plans} plan(s)`);
            } else {
                await conn.query(
                    'UPDATE event_menus SET sort_order = sort_order + 1 WHERE deleted_at IS NULL AND sort_order >= ?', [sort],
                );
                const [res] = await conn.query(
                    `INSERT INTO event_menus
                        (name, slug, description, menu_group, event_category_id, is_default, icon, color,
                         sort_order, is_active, company_id, created_at, updated_at)
                     VALUES (?, ?, ?, 'addon', ?, 0, ?, NULL, ?, 1, ?, NOW(), NOW())`,
                    [MENU.name, MENU.slug, MENU.description, anchor?.event_category_id ?? null, MENU.icon, sort, anchor?.company_id ?? null],
                );
                const [grant] = await conn.query(
                    `INSERT INTO subscription_plan_menus (plan_id, menu_id, sort_order, created_at, updated_at)
                     SELECT p.id, ?, 999, NOW(), NOW()
                       FROM subscription_plans p
                      WHERE p.deleted_at IS NULL
                        AND NOT EXISTS (SELECT 1 FROM subscription_plan_menus g
                                         WHERE g.plan_id = p.id AND g.menu_id = ?)`,
                    [res.insertId, res.insertId],
                );
                console.log(`  + menu ${MENU.slug.padEnd(21)} added #${res.insertId} "${MENU.name}" at order ${sort}, granted to ${grant.affectedRows} plan(s)`);
            }
        }
        if (!APPLY) console.log('\nRe-run with --apply to write it.');
        else console.log('\nDone. The running backend caches plan grants for a while — restart it (or wait) to see the menu.');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
