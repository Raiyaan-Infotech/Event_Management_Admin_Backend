#!/usr/bin/env node
/**
 * Plan limits move from each plan MENU (`subscription_plan_menus.limits_json`)
 * to the PLAN itself — five columns, NULL = unlimited:
 *   max_events, max_guests_per_event, max_photos, max_videos, storage_gb
 * (session §547; no RSVP limit — one answer per guest, so the guest limit caps it).
 *
 * TWO PHASES, because the deploy order runs opposite ways for each:
 *
 *   1. default         ADD the five columns and COPY the old values into any
 *                      that are still NULL. Run BEFORE deploying the new code —
 *                      the new SubscriptionPlan model selects these columns.
 *                      Harmless to the old code, which never selects them.
 *   2. --drop-old      DROP `subscription_plan_menus.limits_json`. Run AFTER the
 *                      new code is live — the old model selects it.
 *
 * Copy rule, per plan and key: the highest value set on any of the plan's menus
 * (what Billing already showed), "100 GB" -> 100, "Unlimited" / blank -> NULL.
 * Keys the new form does not have (max_rsvps, rsvp_closing_days, max_wishes,
 * max_items, …) are not copied; they stay in the backup taken before the drop.
 *
 *   node src/database/tools/apply-plan-limits.js                       dry run, local
 *   node src/database/tools/apply-plan-limits.js --apply               phase 1, local
 *   node src/database/tools/apply-plan-limits.js --drop-old --apply    phase 2, local
 *   (add --prod for production)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
const DROP_OLD = args.includes('--drop-old');
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', '..', 'prod-backups');

const COLUMNS = [
    { key: 'max_events', comment: 'plan limit, NULL = unlimited' },
    { key: 'max_guests_per_event', comment: 'plan limit, NULL = unlimited; also caps RSVPs' },
    { key: 'max_photos', comment: 'plan limit, NULL = unlimited' },
    { key: 'max_videos', comment: 'plan limit, NULL = unlimited' },
    { key: 'storage_gb', comment: 'plan limit in GB, NULL = unlimited' },
];
const KEYS = COLUMNS.map((c) => c.key);

/** "100 GB" -> 100, "200" -> 200, 200 -> 200; blank / "Unlimited" / junk / < 1 -> null. */
const toLimit = (value) => {
    if (value === null || value === undefined) return null;
    const match = String(value).trim().match(/^(\d+)(\s*gb)?$/i);
    const n = match ? Number(match[1]) : NaN;
    return Number.isInteger(n) && n >= 1 ? n : null;
};

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        charset: 'utf8mb4', ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const q = async (sql, p) => (await conn.query(sql, p))[0];
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(`PHASE ${DROP_OLD ? '2 (drop limits_json)' : '1 (add + copy)'} — ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to write)'}\n`);

    const columnsOf = async (table) => (await q(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    )).map((r) => r.COLUMN_NAME);

    try {
        const planCols = await columnsOf('subscription_plans');
        const hasOld = (await columnsOf('subscription_plan_menus')).includes('limits_json');

        if (DROP_OLD) {
            const missing = KEYS.filter((k) => !planCols.includes(k));
            if (missing.length) throw new Error(`Run phase 1 first — plan columns missing: ${missing.join(', ')}`);
            if (!hasOld) { console.log('  = limits_json already dropped — nothing to do'); return; }
            const rows = await q('SELECT id, plan_id, menu_id, limits_json FROM subscription_plan_menus WHERE limits_json IS NOT NULL');
            console.log(`  - limits_json rows holding values: ${rows.length}`);
            if (!APPLY) { console.log('\nDry run — nothing written.'); return; }
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
            const file = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-plan-limits-drop-old-${Date.now()}.json`);
            fs.writeFileSync(file, JSON.stringify(rows, null, 2));
            console.log(`\n  backup: ${file}`);
            await q('ALTER TABLE subscription_plan_menus DROP COLUMN `limits_json`');
            console.log('  + subscription_plan_menus: dropped limits_json');
            return;
        }

        // ── Phase 1 ─────────────────────────────────────────────────────────
        const toAdd = COLUMNS.filter((c) => !planCols.includes(c.key));
        console.log(`  - columns to add: ${toAdd.map((c) => c.key).join(', ') || '(none — already there)'}`);

        // What each plan would get, from the old per-menu values.
        const copies = [];
        if (hasOld) {
            const current = toAdd.length === KEYS.length
                ? []
                : await q(`SELECT id, ${KEYS.filter((k) => planCols.includes(k)).join(', ')} FROM subscription_plans`);
            const currentById = new Map(current.map((r) => [r.id, r]));
            const rows = await q(
                `SELECT pm.plan_id, pm.limits_json FROM subscription_plan_menus pm
                   JOIN subscription_plans p ON p.id = pm.plan_id
                  WHERE pm.limits_json IS NOT NULL`
            );
            const byPlan = new Map();
            for (const r of rows) {
                let limits = r.limits_json;
                if (typeof limits === 'string') { try { limits = JSON.parse(limits); } catch { continue; } }
                if (!limits || typeof limits !== 'object') continue;
                const acc = byPlan.get(r.plan_id) || {};
                for (const key of KEYS) {
                    const n = toLimit(limits[key]);
                    if (n !== null) acc[key] = Math.max(acc[key] ?? 0, n);
                }
                byPlan.set(r.plan_id, acc);
            }
            for (const [planId, acc] of byPlan) {
                const cur = currentById.get(planId) || {};
                const fill = Object.fromEntries(Object.entries(acc).filter(([k]) => cur[k] === null || cur[k] === undefined));
                if (Object.keys(fill).length) copies.push({ planId, fill });
            }
        }
        console.log(`  - plans to fill from old per-menu limits: ${copies.length}`);
        copies.forEach((c) => console.log(`      #${c.planId} ${JSON.stringify(c.fill)}`));

        if (!APPLY) { console.log('\nDry run — nothing written.'); return; }

        if (toAdd.length) {
            // ADD COLUMN commits implicitly — one ALTER so the table never has
            // only some of the five. Placed after event_category_id, the same
            // order as initial_setup.sql.
            let after = 'event_category_id';
            const clauses = [];
            for (const c of COLUMNS) {
                if (toAdd.includes(c)) {
                    clauses.push(`ADD COLUMN \`${c.key}\` int unsigned DEFAULT NULL COMMENT '${c.comment}' AFTER \`${after}\``);
                }
                after = c.key;
            }
            await q(`ALTER TABLE subscription_plans ${clauses.join(', ')}`);
            console.log(`  + subscription_plans: added ${toAdd.map((c) => c.key).join(', ')}`);
        }
        for (const { planId, fill } of copies) {
            await q('UPDATE subscription_plans SET ? WHERE id = ?', [fill, planId]);
        }
        if (copies.length) console.log(`  + filled ${copies.length} plan(s)`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
