#!/usr/bin/env node
/**
 * Drops the last website/app split on plans:
 *   subscription_plan_menus.for_website / for_mobile   (per-menu W/M, session §544)
 *   subscription_plans.for_website / for_mobile        (the wizard's "Menu For", §546)
 *
 * Menus stopped being website/app in §520 (Menu Type) and §523
 * (`event_menus.is_website` / `is_mobile` dropped). The plan-side copies were
 * leftovers. After this, a plan grants its menus everywhere and the menu's own
 * per-platform Active switch (`active_website` / `active_mobile`) is the only
 * thing that decides where it shows.
 *
 * The dry run compares, per plan and platform, what the OLD rule grants (every
 * flag still present + menu Active) with the NEW rule (menu Active only). Any
 * difference is printed, so it is visible before the drop whether a client
 * would gain or lose a menu. Works whichever columns are still present, so the
 * same tool finishes a database that is partly done.
 *
 * Deploy the code that no longer reads these columns FIRST — the models select
 * every column, so the old code fails once they are gone.
 *
 *   node src/database/tools/drop-plan-menu-platform.js
 *   node src/database/tools/drop-plan-menu-platform.js --apply
 *   node src/database/tools/drop-plan-menu-platform.js --prod --apply
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
const TABLES = ['subscription_plan_menus', 'subscription_plans'];
const COLUMNS = ['for_website', 'for_mobile'];
const PLATFORMS = [
    { name: 'website', flag: 'for_website', menuActive: 'active_website' },
    { name: 'mobile', flag: 'for_mobile', menuActive: 'active_mobile' },
];

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
        const presentRows = await q(
            `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND COLUMN_NAME IN (?)`,
            [TABLES, COLUMNS]
        );
        const present = Object.fromEntries(TABLES.map((t) => [
            t, presentRows.filter((r) => r.TABLE_NAME === t).map((r) => r.COLUMN_NAME),
        ]));
        if (!presentRows.length) { console.log('  = all columns already dropped — nothing to do'); return; }
        TABLES.forEach((t) => console.log(`  - ${t.padEnd(24)} ${present[t].join(', ') || '(already dropped)'}`));

        const planCols = present.subscription_plans.map((c) => `, ${c}`).join('');
        const menuCols = present.subscription_plan_menus.map((c) => `, pm.${c}`).join('');
        const plans = await q(`SELECT id, name${planCols} FROM subscription_plans WHERE deleted_at IS NULL ORDER BY id`);
        const grants = await q(
            `SELECT pm.plan_id, pm.menu_id${menuCols}, m.slug, m.active_website, m.active_mobile
               FROM subscription_plan_menus pm
               JOIN event_menus m ON m.id = pm.menu_id AND m.deleted_at IS NULL`
        );
        // A column that is already gone counts as "on" — that is what the code
        // deployed alongside this tool treats it as.
        const on = (row, col) => row[col] === undefined || Number(row[col]) === 1;

        let differences = 0;
        for (const plan of plans) {
            const mine = grants.filter((g) => g.plan_id === plan.id);
            for (const p of PLATFORMS) {
                const active = mine.filter((g) => Number(g[p.menuActive]) === 1);
                const before = new Set(on(plan, p.flag) ? active.filter((g) => on(g, p.flag)).map((g) => g.slug) : []);
                const after = new Set(active.map((g) => g.slug));
                const gained = [...after].filter((s) => !before.has(s));
                const lost = [...before].filter((s) => !after.has(s));
                if (gained.length || lost.length) {
                    differences += 1;
                    console.log(`  ! plan #${plan.id} ${plan.name} — ${p.name}:`
                        + (gained.length ? ` gains [${gained.join(', ')}]` : '')
                        + (lost.length ? ` loses [${lost.join(', ')}]` : ''));
                }
            }
        }
        console.log(`  - plans checked: ${plans.length}, grants: ${grants.length}`);
        console.log(differences
            ? `  ! ${differences} plan/platform pair(s) change — review above before applying`
            : '  = no plan/platform changes: clients see exactly the same menus after the drop');

        if (!APPLY) { console.log('\nDry run — nothing written.'); return; }

        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const backup = {};
        for (const t of TABLES) {
            if (!present[t].length) continue;
            backup[t] = { columns: present[t], rows: await q(`SELECT id, ${present[t].join(', ')} FROM ${t}`) };
        }
        const file = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-drop-plan-menu-platform-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify(backup, null, 2));
        console.log(`\n  backup: ${file}`);

        // DDL commits implicitly in MySQL, so one ALTER per table keeps a table
        // from ever sitting with only one of its two columns dropped.
        for (const t of TABLES) {
            if (!present[t].length) continue;
            await q(`ALTER TABLE ${t} ${present[t].map((c) => `DROP COLUMN \`${c}\``).join(', ')}`);
            console.log(`  + ${t}: dropped ${present[t].join(', ')}`);
        }
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
