#!/usr/bin/env node
/**
 * Adds the main relations missing from the WEDDING relationship list
 * (guest_relationship_options, Jamal 2026-10-27). Plain names — the side
 * (Groom / Bride) is picked separately on the forms. The existing 16 rows stay;
 * Family Friend / Colleague / Neighbor / Other move to the end.
 *
 * Re-runnable: a name already in the Wedding list (any case) is not added again.
 *
 *   node src/database/tools/apply-wedding-relationships.js                  dry run, local
 *   node src/database/tools/apply-wedding-relationships.js --apply          local
 *   node src/database/tools/apply-wedding-relationships.js --prod           dry run, production
 *   node src/database/tools/apply-wedding-relationships.js --prod --apply   production
 */

require('dotenv').config();
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

const COMPANY_ID = 1;

/** The final order after the 12 Bride's / Groom's rows (sort 1-12). */
const TAIL = [
    'Grandfather', 'Grandmother', 'Uncle', 'Aunt', 'Cousin',
    'Brother-in-law', 'Sister-in-law', 'Nephew', 'Niece',
    'Relative', 'Friend',
    'Family Friend', 'Colleague', 'Neighbor', 'Other',
];
const FIRST_SORT = 13;

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
        const [cats] = await conn.query("SELECT id FROM event_categories WHERE name = 'Wedding' AND deleted_at IS NULL");
        if (cats.length !== 1) {
            console.log(`  ! expected one 'Wedding' category, found ${cats.length} — nothing done`);
            return;
        }
        const catId = cats[0].id;
        const [rows] = await conn.query(
            'SELECT id, name, sort_order FROM guest_relationship_options '
            + 'WHERE event_category_id = ? AND company_id = ? AND deleted_at IS NULL',
            [catId, COMPANY_ID],
        );
        const byName = new Map(rows.map((r) => [r.name.trim().toLowerCase(), r]));
        console.log(`  Wedding (category #${catId}) has ${rows.length} relations now\n`);

        const inserts = [];
        const moves = [];
        TAIL.forEach((name, i) => {
            const sort = FIRST_SORT + i;
            const row = byName.get(name.toLowerCase());
            if (!row) {
                inserts.push([name, sort]);
                console.log(`  + ${name.padEnd(16)} sort ${sort}  ${APPLY ? 'adding' : 'WOULD ADD'}`);
            } else if (row.sort_order !== sort) {
                moves.push([row.id, sort]);
                console.log(`  ~ ${row.name.padEnd(16)} sort ${row.sort_order} -> ${sort}  ${APPLY ? 'moving' : 'WOULD MOVE'}`);
            } else {
                console.log(`  = ${row.name.padEnd(16)} sort ${sort}  already there`);
            }
        });

        if (!APPLY || (!inserts.length && !moves.length)) {
            if (!APPLY) console.log('\nDry run — add --apply to write.');
            return;
        }

        await conn.beginTransaction();
        try {
            if (inserts.length) {
                await conn.query(
                    'INSERT INTO guest_relationship_options (event_category_id, name, icon, sort_order, is_active, company_id) VALUES ?',
                    [inserts.map(([name, sort]) => [catId, name, '', sort, 1, COMPANY_ID])],
                );
            }
            for (const [id, sort] of moves) {
                await conn.query('UPDATE guest_relationship_options SET sort_order = ? WHERE id = ?', [sort, id]);
            }
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        }
        console.log(`\n  done: ${inserts.length} added, ${moves.length} moved`);
    } finally {
        await conn.end();
    }
})().catch((e) => { console.error(e.message); process.exit(1); });
