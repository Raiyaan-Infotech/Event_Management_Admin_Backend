#!/usr/bin/env node
/**
 * Drops `subscription_plan_menus.for_website` / `for_mobile`.
 *
 * They were the plan-side copy of the menu's old Menu Type (session §520
 * removed Menu Type, §523 dropped `event_menus.is_website` / `is_mobile`).
 * With no per-menu platform left, a plan grants a menu on every platform the
 * PLAN is sold on (`subscription_plans.for_website` / `for_mobile`), and the
 * menu's own per-platform Active switch still decides where it shows.
 *
 * The dry run compares, per plan and platform, what the OLD rule grants
 * (plan-menu flag + menu Active) with what the NEW rule grants (plan flag +
 * menu Active). Any difference is printed, so it is visible before the drop
 * whether a client would gain or lose a menu.
 *
 * Deploy the code that no longer reads these columns FIRST — the model
 * selects every column, so the old code fails once they are gone.
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
const COLUMNS = ['for_website', 'for_mobile'];
const PLATFORMS = [
    { name: 'website', planFlag: 'for_website', menuActive: 'active_website' },
    { name: 'mobile', planFlag: 'for_mobile', menuActive: 'active_mobile' },
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
        const present = (await q(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription_plan_menus'
                AND COLUMN_NAME IN (?)`,
            [COLUMNS]
        )).map((r) => r.COLUMN_NAME);
        if (!present.length) { console.log('  = columns already dropped — nothing to do'); return; }
        console.log(`  - columns present: ${present.join(', ')}`);

        const plans = await q('SELECT id, name, for_website, for_mobile FROM subscription_plans WHERE deleted_at IS NULL ORDER BY id');
        const grants = await q(
            `SELECT pm.plan_id, pm.menu_id, ${present.map((c) => `pm.${c}`).join(', ')},
                    m.slug, m.active_website, m.active_mobile
               FROM subscription_plan_menus pm
               JOIN event_menus m ON m.id = pm.menu_id AND m.deleted_at IS NULL`
        );

        let differences = 0;
        for (const plan of plans) {
            const mine = grants.filter((g) => g.plan_id === plan.id);
            for (const p of PLATFORMS) {
                const active = mine.filter((g) => Number(g[p.menuActive]) === 1);
                const before = new Set(active.filter((g) => Number(g[p.planFlag]) === 1).map((g) => g.slug));
                const after = new Set(Number(plan[p.planFlag]) === 1 ? active.map((g) => g.slug) : []);
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
        const rows = await q(`SELECT id, plan_id, menu_id, ${present.join(', ')} FROM subscription_plan_menus`);
        const file = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-drop-plan-menu-platform-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify({ columns: present, rows }, null, 2));
        console.log(`\n  backup: ${file} (${rows.length} rows)`);

        // DDL commits implicitly in MySQL, so one ALTER for both columns keeps
        // the table from ever sitting with only one of them dropped.
        await q(`ALTER TABLE subscription_plan_menus ${present.map((c) => `DROP COLUMN \`${c}\``).join(', ')}`);
        console.log(`  + dropped: ${present.join(', ')}`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
