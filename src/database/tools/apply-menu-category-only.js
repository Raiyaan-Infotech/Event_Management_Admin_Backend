#!/usr/bin/env node
/**
 * Event menus are scoped by CATEGORY only — no event type, no religion, no
 * Website/Mobile "menu type".
 *
 * ⚠ HISTORICAL — applied to production 2026-09-19. It reads event_type_id /
 * religion_id / is_website / is_mobile, which were later dropped when event
 * type and religion left the project, so it fails on a current schema.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Menu Management used to require a type + religion on every menu, so each
 * Wedding menu existed once per religion (Gallery for Nikah, Gallery for
 * Thirumanam, …, slugs `gallery`, `gallery-2`, …). Plan screens then listed
 * every copy. Those three fields are gone from the form; this tool folds the
 * existing copies into one menu per (company, category, group, name).
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 *   1. Groups live core / additional / custom menus by
 *      (company_id, event_category_id, menu_group, lower(name)). In each group
 *      the SURVIVOR is the row whose slug has no `-N` suffix, else the lowest id.
 *   2. Re-points every reference from a copy to its survivor:
 *        subscription_plan_menus — moved, or merged into the survivor's grant
 *          (W/M OR-ed, survivor's limits kept, copy's used if survivor has none)
 *        events.menu_ids, plan_types.menu_ids — ids swapped and de-duplicated
 *   3. Soft-deletes the copies (deleted_at), so a revert is an UPDATE.
 *   4. Survivor slug loses its `-N` suffix when the bare slug is free.
 *   5. Clears event_type_id / religion_id on every live menu and sets
 *      is_website = is_mobile = 1 on event-feature menus — the PLAN's W/M
 *      switch is what decides a platform.
 *   6. Clears event_type_id / religion_id on every plan — a plan is scoped by
 *      category only too (NULL = all, which is what production plans had).
 *
 * A backup of every row it touches is written first (--apply only).
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-menu-category-only.js
 *   node src/database/tools/apply-menu-category-only.js --apply
 *   node src/database/tools/apply-menu-category-only.js --prod
 *   node src/database/tools/apply-menu-category-only.js --prod --apply
 *
 * Dry runs by default. Idempotent: a second run finds nothing to merge.
 * Writes are set-based (one statement per step), not per row — production is
 * ~370ms a query.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const FEATURE_GROUPS = ['core', 'additional', 'custom'];
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', '..', 'prod-backups');

const baseSlug = (slug) => String(slug).replace(/-\d+$/, '');
const parseIds = (raw) => {
    if (raw === null || raw === undefined) return null;
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list : null;
};

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        const [menus] = await conn.query(
            `SELECT id, name, slug, menu_group, company_id, event_category_id, event_type_id, religion_id,
                    is_website, is_mobile
               FROM event_menus
              WHERE deleted_at IS NULL
              ORDER BY id`,
        );

        // ── 1. groups and survivors ─────────────────────────────────────────
        const groups = new Map();
        for (const m of menus.filter((r) => FEATURE_GROUPS.includes(r.menu_group))) {
            const key = [m.company_id, m.event_category_id, m.menu_group, m.name.trim().toLowerCase()].join('|');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(m);
        }

        const remap = new Map(); // copy id -> survivor id
        const renames = [];      // { id, from, to }
        const liveSlugs = new Set(menus.map((m) => m.slug));

        for (const rows of groups.values()) {
            if (rows.length < 2) continue;
            const survivor = rows.find((r) => r.slug === baseSlug(r.slug)) || rows[0];
            const copies = rows.filter((r) => r !== survivor);
            copies.forEach((c) => remap.set(c.id, survivor.id));
            console.log(`  ~ ${survivor.name.padEnd(24)} keep #${survivor.id} (${survivor.slug}), fold ${copies.map((c) => `#${c.id} ${c.slug}`).join(', ')}`);
        }

        // Slugs freed by the copies count as available for the survivor.
        for (const id of remap.keys()) liveSlugs.delete(menus.find((m) => m.id === id).slug);
        const survivorIds = new Set(remap.values());
        for (const m of menus.filter((r) => survivorIds.has(r.id))) {
            const bare = baseSlug(m.slug);
            if (bare !== m.slug && !liveSlugs.has(bare)) {
                renames.push({ id: m.id, from: m.slug, to: bare });
                liveSlugs.delete(m.slug);
                liveSlugs.add(bare);
            }
        }
        renames.forEach((r) => console.log(`  ~ slug #${r.id} ${r.from} -> ${r.to}`));

        const copyIds = [...remap.keys()];
        if (!copyIds.length) console.log('  = no duplicate menus to fold');

        // ── 2. references ───────────────────────────────────────────────────
        const [grants] = copyIds.length
            ? await conn.query('SELECT * FROM subscription_plan_menus WHERE menu_id IN (?) OR menu_id IN (?)',
                [copyIds, [...survivorIds]])
            : [[]];
        const grantKey = (planId, menuId) => `${planId}|${menuId}`;
        const grantByKey = new Map(grants.map((g) => [grantKey(g.plan_id, g.menu_id), g]));

        const grantMoves = [];   // copy grant id -> survivor menu id
        const grantMerges = [];  // { keepId, dropId, web, mob, limits }
        const touchedSurvivorGrants = new Map();
        for (const g of grants.filter((r) => remap.has(r.menu_id))) {
            const target = remap.get(g.menu_id);
            const existing = touchedSurvivorGrants.get(grantKey(g.plan_id, target))
                || grantByKey.get(grantKey(g.plan_id, target));
            if (!existing) {
                grantMoves.push({ id: g.id, menuId: target });
                touchedSurvivorGrants.set(grantKey(g.plan_id, target), { ...g, menu_id: target });
            } else {
                existing.for_website = existing.for_website || g.for_website ? 1 : 0;
                existing.for_mobile = existing.for_mobile || g.for_mobile ? 1 : 0;
                if (!existing.limits_json && g.limits_json) existing.limits_json = g.limits_json;
                grantMerges.push({ keep: existing, dropId: g.id });
            }
        }
        console.log(`  · plan grants: ${grantMoves.length} moved, ${grantMerges.length} merged into the survivor's grant`);

        const swapIds = (list) => {
            const next = [...new Set(list.map((id) => remap.get(Number(id)) ?? Number(id)))];
            return JSON.stringify(next) === JSON.stringify(list.map(Number)) ? null : next;
        };
        const jsonFixes = async (table) => {
            const [rows] = await conn.query(`SELECT id, menu_ids FROM ${table} WHERE menu_ids IS NOT NULL`);
            return rows
                .map((r) => ({ id: r.id, before: parseIds(r.menu_ids) }))
                .filter((r) => r.before)
                .map((r) => ({ ...r, after: swapIds(r.before) }))
                .filter((r) => r.after);
        };
        const eventFixes = copyIds.length ? await jsonFixes('events') : [];
        const planTypeFixes = copyIds.length ? await jsonFixes('plan_types') : [];
        console.log(`  · events.menu_ids: ${eventFixes.length} row(s) · plan_types.menu_ids: ${planTypeFixes.length} row(s)`);

        // ── 5. scope columns ────────────────────────────────────────────────
        const scoped = menus.filter((m) => !remap.has(m.id) && (m.event_type_id || m.religion_id));
        const platformFix = menus.filter((m) => !remap.has(m.id) && FEATURE_GROUPS.includes(m.menu_group)
            && (!m.is_website || !m.is_mobile));
        console.log(`  · clear type/religion on ${scoped.length} menu(s); set Website+Mobile on ${platformFix.length}`);

        // ── 6. plans ────────────────────────────────────────────────────────
        const [scopedPlans] = await conn.query(
            `SELECT id, name, event_type_id, religion_id FROM subscription_plans
              WHERE deleted_at IS NULL AND (event_type_id IS NOT NULL OR religion_id IS NOT NULL)`,
        );
        console.log(`  · clear type/religion on ${scopedPlans.length} plan(s)`
            + (scopedPlans.length ? `: ${scopedPlans.map((p) => `#${p.id}`).join(', ')}` : ''));

        if (!APPLY) {
            console.log('\nDry run — nothing written.');
            return;
        }

        // ── backup ──────────────────────────────────────────────────────────
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const backupFile = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-menu-category-only-${Date.now()}.json`);
        fs.writeFileSync(backupFile, JSON.stringify({
            menus, grants, eventFixes, planTypeFixes, scopedPlans, remap: [...remap], renames,
        }, null, 2));
        console.log(`\n  backup: ${backupFile}`);

        await conn.beginTransaction();
        try {
            if (grantMerges.length) {
                const keepRows = [...new Map(grantMerges.map((m) => [m.keep.id, m.keep])).values()];
                await conn.query(
                    `UPDATE subscription_plan_menus SET
                        for_website = CASE id ${keepRows.map(() => 'WHEN ? THEN ?').join(' ')} END,
                        for_mobile  = CASE id ${keepRows.map(() => 'WHEN ? THEN ?').join(' ')} END,
                        limits_json = CASE id ${keepRows.map(() => 'WHEN ? THEN ?').join(' ')} END,
                        updated_at = NOW()
                      WHERE id IN (?)`,
                    [
                        ...keepRows.flatMap((k) => [k.id, k.for_website]),
                        ...keepRows.flatMap((k) => [k.id, k.for_mobile]),
                        ...keepRows.flatMap((k) => [k.id, k.limits_json === null ? null
                            : (typeof k.limits_json === 'string' ? k.limits_json : JSON.stringify(k.limits_json))]),
                        keepRows.map((k) => k.id),
                    ],
                );
                await conn.query('DELETE FROM subscription_plan_menus WHERE id IN (?)', [grantMerges.map((m) => m.dropId)]);
            }
            if (grantMoves.length) {
                await conn.query(
                    `UPDATE subscription_plan_menus
                        SET menu_id = CASE id ${grantMoves.map(() => 'WHEN ? THEN ?').join(' ')} END, updated_at = NOW()
                      WHERE id IN (?)`,
                    [...grantMoves.flatMap((g) => [g.id, g.menuId]), grantMoves.map((g) => g.id)],
                );
            }
            for (const [table, fixes] of [['events', eventFixes], ['plan_types', planTypeFixes]]) {
                if (!fixes.length) continue;
                await conn.query(
                    `UPDATE ${table} SET menu_ids = CASE id ${fixes.map(() => 'WHEN ? THEN CAST(? AS JSON)').join(' ')} END
                      WHERE id IN (?)`,
                    [...fixes.flatMap((f) => [f.id, JSON.stringify(f.after)]), fixes.map((f) => f.id)],
                );
            }
            if (copyIds.length) {
                await conn.query('UPDATE event_menus SET deleted_at = NOW(), updated_at = NOW() WHERE id IN (?)', [copyIds]);
            }
            if (renames.length) {
                await conn.query(
                    `UPDATE event_menus SET slug = CASE id ${renames.map(() => 'WHEN ? THEN ?').join(' ')} END, updated_at = NOW()
                      WHERE id IN (?)`,
                    [...renames.flatMap((r) => [r.id, r.to]), renames.map((r) => r.id)],
                );
            }
            await conn.query(
                `UPDATE event_menus SET event_type_id = NULL, religion_id = NULL, updated_at = NOW()
                  WHERE deleted_at IS NULL AND (event_type_id IS NOT NULL OR religion_id IS NOT NULL)`,
            );
            await conn.query(
                `UPDATE event_menus SET is_website = 1, is_mobile = 1, updated_at = NOW()
                  WHERE deleted_at IS NULL AND menu_group IN (?) AND (is_website = 0 OR is_mobile = 0)`,
                [FEATURE_GROUPS],
            );
            await conn.query(
                `UPDATE subscription_plans SET event_type_id = NULL, religion_id = NULL, updated_at = NOW()
                  WHERE deleted_at IS NULL AND (event_type_id IS NOT NULL OR religion_id IS NOT NULL)`,
            );
            await conn.commit();
            console.log('  applied.');
        } catch (err) {
            await conn.rollback();
            throw err;
        }
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(`\nFAILED: ${err.message}`);
    process.exit(1);
});
