#!/usr/bin/env node
/**
 * Menu Management order (event_menus.sort_order) — Jamal, 2026-10-19:
 *
 *   Splash · Invitation · Venue · Agenda · Family · Participants · RSVP ·
 *   Gallery · Contact Us
 *
 * first, then every other menu in its current order. Home Quick Actions (the
 * "Add More" slider and the default grid) read this order from the server, so
 * nothing about it lives in the app. ⚠ The same order is also the order of the
 * menu tiles inside an event (one Menu Management order for everything).
 *
 * Matched by BASE slug, so a category copy (`gallery-2`) moves with its menu.
 * Re-runnable: rows already in place are left alone.
 *
 *   node src/database/tools/apply-menu-order.js                  dry run, local
 *   node src/database/tools/apply-menu-order.js --apply          local
 *   node src/database/tools/apply-menu-order.js --prod           dry run, production
 *   node src/database/tools/apply-menu-order.js --prod --apply   production
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

const ORDER = [
    'splash-screens', 'event-invitation', 'venue', 'agenda', 'family',
    'participants', 'rsvp', 'gallery', 'contact-us',
];

const baseSlug = (slug) => String(slug || '').replace(/-\d+$/, '');

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
        const [menus] = await conn.query(
            'SELECT id, name, slug, sort_order FROM event_menus WHERE deleted_at IS NULL ORDER BY sort_order, id',
        );
        const rank = (m) => {
            const i = ORDER.indexOf(baseSlug(m.slug));
            return i < 0 ? ORDER.length : i;
        };
        const sorted = [...menus].sort((a, b) =>
            rank(a) - rank(b) || a.sort_order - b.sort_order || a.id - b.id);

        let changes = 0;
        const updates = [];
        sorted.forEach((m, i) => {
            const next = i + 1;
            const mark = Number(m.sort_order) === next ? '=' : '~';
            if (mark === '~') {
                changes += 1;
                updates.push([next, m.id]);
            }
            console.log(`  ${mark} ${String(next).padStart(2)}. ${m.name.padEnd(20)} ${m.slug.padEnd(20)} (was ${m.sort_order})`);
        });
        if (!changes) {
            console.log('\nAlready in this order.');
            return;
        }
        if (!APPLY) {
            console.log(`\n${changes} row(s) would move. Re-run with --apply.`);
            return;
        }
        // One statement (production is ~370 ms a query).
        const cases = updates.map(() => 'WHEN ? THEN ?').join(' ');
        const params = updates.flatMap(([so, id]) => [id, so]);
        await conn.query(
            `UPDATE event_menus SET sort_order = CASE id ${cases} END WHERE id IN (${updates.map(() => '?').join(',')})`,
            [...params, ...updates.map(([, id]) => id)],
        );
        console.log(`\n${changes} row(s) moved. The running backend caches menus briefly — restart or wait a minute.`);
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
