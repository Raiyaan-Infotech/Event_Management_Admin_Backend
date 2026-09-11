#!/usr/bin/env node
/**
 * Client-portal SIDEBAR sections become plan menus.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 * The portal sidebar was a fixed list — every client saw Guests, Messages,
 * Splash Screens, Analytics and Notification Templates whatever their plan
 * said. Those sections are now gated by the plan exactly like event features
 * are: the section shows only when the client's plan grants its menu on the
 * WEBSITE. (RSVPs is gated by the existing `rsvp` menu, so it needs no row.)
 *
 *   1. `event_menus.menu_group` gains 'portal'. A portal section is NOT an
 *      event feature: the Create Event wizard and the mobile app never offer
 *      it, and `getEventOptions` returns these slugs separately as
 *      `portal_sections`.
 *   2. One `event_menus` row per section, website-only.
 *   3. ⚠ Each section CREATED by this run is granted to EVERY existing plan
 *      (website on, mobile off). Without that, the moment the portal ships
 *      every client loses these sections until an admin re-grants them. After
 *      that the admin removes a section from a plan in Manage Plan Menus.
 *      A section that already exists is never re-granted, so a re-run cannot
 *      undo what an admin removed.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-portal-section-menus.js
 *   node src/database/tools/apply-portal-section-menus.js --apply
 *   node src/database/tools/apply-portal-section-menus.js --prod --apply
 *
 * Dry runs by default; `--prod` dry-runs too until `--apply` is added.
 * Grants are one INSERT … SELECT per section, not a loop over plans —
 * production is ~370ms a query.
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

/** Slugs here must match `section` in the portal's `lib/navigation.ts`. */
const SECTIONS = [
    { slug: 'guests', name: 'Guests', description: 'Client portal: guest list, groups and import.' },
    { slug: 'messages', name: 'Messages', description: 'Client portal: send messages and push notifications to guests.' },
    { slug: 'splash-screens', name: 'Splash Screens', description: 'Client portal: build the splash an event opens with.' },
    { slug: 'analytics', name: 'Analytics', description: 'Client portal: event and guest analytics.' },
    { slug: 'notification-templates', name: 'Notification Templates', description: 'Client portal: per-event on/off for notification templates.' },
];

const ENUM_WITH_PORTAL = "enum('core','additional','custom','portal')";

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
        // ── 1. menu_group gains 'portal' ─────────────────────────────────────
        const [[col]] = await conn.query(
            `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_menus' AND COLUMN_NAME = 'menu_group'`,
            [process.env.DB_NAME],
        );
        const hasPortal = String(col?.t || '').includes("'portal'");
        if (hasPortal) {
            console.log(`  = ${'menu_group enum'.padEnd(28)} already has 'portal'`);
        } else if (!APPLY) {
            console.log(`  + ${'menu_group enum'.padEnd(28)} WOULD CHANGE ${col?.t} -> ${ENUM_WITH_PORTAL}`);
        } else {
            await conn.query(
                `ALTER TABLE event_menus
                   MODIFY COLUMN menu_group ${ENUM_WITH_PORTAL} NOT NULL DEFAULT 'core'`,
            );
            console.log(`  + ${'menu_group enum'.padEnd(28)} added 'portal'`);
        }

        const [[{ plans }]] = await conn.query(
            'SELECT COUNT(*) AS plans FROM subscription_plans WHERE deleted_at IS NULL',
        );

        // ── The company the menu catalogue lives under ───────────────────────
        // ⚠ The admin menu list (base.service getAll) matches `company_id = X`
        // exactly, so a row with NULL never appears in Manage Plan Menus — the
        // first run of this tool created them that way and the admin could not
        // see or toggle a single section. Taken from the existing event menus
        // rather than hard-coded, so a production catalogue under another
        // company id gets the right one.
        const [[{ companyId }]] = await conn.query(
            `SELECT company_id AS companyId FROM event_menus
              WHERE deleted_at IS NULL AND menu_group <> 'portal' AND company_id IS NOT NULL
              GROUP BY company_id ORDER BY COUNT(*) DESC LIMIT 1`,
        ).then(([rows]) => [rows.length ? rows : [{ companyId: null }]]);
        console.log(`  · ${'catalogue company_id'.padEnd(28)} ${companyId ?? '(none found — left NULL)'}`);

        if (companyId !== null && hasPortal) {
            const [[{ n: orphaned }]] = await conn.query(
                `SELECT COUNT(*) AS n FROM event_menus
                  WHERE menu_group = 'portal' AND company_id IS NULL AND deleted_at IS NULL`,
            );
            if (!orphaned) {
                console.log(`  = ${'portal menus company_id'.padEnd(28)} all set`);
            } else if (!APPLY) {
                console.log(`  + ${'portal menus company_id'.padEnd(28)} WOULD SET company_id = ${companyId} on ${orphaned}`);
            } else {
                await conn.query(
                    `UPDATE event_menus SET company_id = ?, updated_at = NOW()
                      WHERE menu_group = 'portal' AND company_id IS NULL AND deleted_at IS NULL`,
                    [companyId],
                );
                console.log(`  + ${'portal menus company_id'.padEnd(28)} set company_id = ${companyId} on ${orphaned}`);
            }
        }

        // ── 2 + 3. one menu per section, granted to every plan when created ──
        for (const [i, s] of SECTIONS.entries()) {
            const [[existing]] = await conn.query(
                'SELECT id, menu_group FROM event_menus WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
                [s.slug],
            );
            if (existing) {
                console.log(`  = ${s.slug.padEnd(28)} exists (id ${existing.id}, ${existing.menu_group}) — grants left alone`);
                continue;
            }
            if (!APPLY) {
                console.log(`  + ${s.slug.padEnd(28)} WOULD CREATE (portal, website only) and grant to ${plans} plan(s)`);
                continue;
            }
            const [ins] = await conn.query(
                `INSERT INTO event_menus
                   (name, slug, description, menu_group,
                    is_website, is_mobile, display_website, display_mobile,
                    active_website, active_mobile, icon, sort_order, is_active,
                    company_id, created_at, updated_at)
                 VALUES (?, ?, ?, 'portal', 1, 0, 1, 0, 1, 0, '', ?, 1, ?, NOW(), NOW())`,
                [s.name, s.slug, s.description, 900 + i, companyId],
            );
            const [grant] = await conn.query(
                `INSERT IGNORE INTO subscription_plan_menus
                   (plan_id, menu_id, for_website, for_mobile, limits_json, sort_order, created_at, updated_at)
                 SELECT id, ?, 1, 0, NULL, ?, NOW(), NOW()
                   FROM subscription_plans WHERE deleted_at IS NULL`,
                [ins.insertId, 900 + i],
            );
            console.log(`  + ${s.slug.padEnd(28)} created (id ${ins.insertId}), granted to ${grant.affectedRows} plan(s)`);
        }

        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
