#!/usr/bin/env node
/**
 * Read-only: which plan grants every mobile menu, and what plan/account a
 * given mobile number currently has. Written to check whether "Gold" (plan 4)
 * genuinely covers ALL menus before assigning it to a test account for the
 * offline/showcase-events testing pass.
 *
 *   node src/database/tools/check-plan-menus.js
 *   node src/database/tools/check-plan-menus.js --prod
 *   node src/database/tools/check-plan-menus.js --prod --mobile 9884699435
 *
 * Never writes anything — SELECTs only.
 */
require('dotenv').config();
const path = require('path');

const PROD = process.argv.includes('--prod');
if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};
const MOBILE = argValue('--mobile');

const db = require('../../models');
const { sequelize } = db;

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);
    try {
        const [allMenus] = await sequelize.query(
            `SELECT id, name, slug, menu_group, event_category_id, event_type_id, is_active FROM event_menus ORDER BY id`,
        );
        console.log(`event_menus table: ${allMenus.length} row(s) total`);
        console.table(allMenus);

        const [plans] = await sequelize.query(`
            SELECT p.id, p.name, p.is_active, p.event_category_id, p.event_type_id, p.religion_id,
                   SUM(CASE WHEN pm.for_mobile = 1 THEN 1 ELSE 0 END) AS mobile_grants_total,
                   SUM(CASE WHEN pm.for_website = 1 THEN 1 ELSE 0 END) AS website_grants_total
            FROM subscription_plans p
            LEFT JOIN subscription_plan_menus pm ON pm.plan_id = p.id
            GROUP BY p.id, p.name, p.is_active, p.event_category_id, p.event_type_id, p.religion_id
            ORDER BY p.id`);
        console.log('\nPlans (scope columns NULL = "all categories/types/religions"; grants_total INCLUDES portal/app-group menus, not just event features):');
        console.table(plans);

        // The real event-feature menu count per plan (menu_group NOT IN portal/app) —
        // this is what the wizard/seeder actually offers when creating an event.
        for (const plan of plans) {
            const [feat] = await sequelize.query(`
                SELECT m.id, m.slug, m.menu_group
                FROM subscription_plan_menus pm
                JOIN event_menus m ON m.id = pm.menu_id
                WHERE pm.plan_id = :id AND pm.for_mobile = 1
                  AND m.menu_group NOT IN ('portal','app') AND m.is_active = 1
                ORDER BY m.id`, { replacements: { id: plan.id } });
            console.log(`  Plan #${plan.id} "${plan.name}"  (cat=${plan.event_category_id ?? 'ANY'}, type=${plan.event_type_id ?? 'ANY'}): `
                + `${feat.length} real event-feature menu(s) on mobile — ${feat.map((f) => f.slug).join(', ') || '(none)'}`);
        }

        const [cats] = await sequelize.query(`SELECT id, name FROM event_categories ORDER BY id`);
        console.log('\nEvent categories:');
        console.table(cats);

        const activeMenuIds = allMenus.filter((m) => m.is_active === 1 || m.is_active === true).map((m) => m.id);
        for (const plan of plans) {
            const [grants] = await sequelize.query(
                `SELECT menu_id FROM subscription_plan_menus WHERE plan_id = :id AND for_mobile = 1`,
                { replacements: { id: plan.id } },
            );
            const grantedIds = new Set(grants.map((g) => g.menu_id));
            const missing = activeMenuIds.filter((id) => !grantedIds.has(id));
            if (!missing.length) {
                console.log(`  Plan #${plan.id} "${plan.name}" grants ALL ${activeMenuIds.length} active menus on mobile.`);
            } else {
                console.log(`  Plan #${plan.id} "${plan.name}" is missing ${missing.length} menu(s) on mobile: ${missing.join(', ')}`);
            }
        }

        if (MOBILE) {
            const digits = String(MOBILE).replace(/\D/g, '').slice(-10);
            const [clients] = await sequelize.query(
                `SELECT id, name, email, mobile, subscription_plan_id, company_id
                   FROM website_clients WHERE mobile = :m`,
                { replacements: { m: digits } },
            );
            console.log(`\nAccount(s) with mobile ${digits}:`);
            console.table(clients);
        }
    } finally {
        await sequelize.close();
    }
})().catch((e) => { console.error('\nFAILED:', e.message, '\n'); process.exit(1); });
