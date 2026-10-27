#!/usr/bin/env node
/**
 * Add Responsibility flow (2026-10-27):
 *   1. adds events.contact_responsibility_ids
 *      (src/database/migrations/sql/20261027-event-contact-responsibilities.sql);
 *   2. gives every active event category the ten Responsibilities of Jamal's
 *      design, with descriptions — a name the category already has keeps its
 *      row, only an empty description is filled.
 *
 * Re-runnable: nothing is added twice.
 *
 *   node src/database/tools/apply-contact-responsibilities.js                  dry run, local
 *   node src/database/tools/apply-contact-responsibilities.js --apply          local
 *   node src/database/tools/apply-contact-responsibilities.js --prod           dry run, production
 *   node src/database/tools/apply-contact-responsibilities.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend — the Event
 * model reads the new column, so every event query fails without it.
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

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261027-event-contact-responsibilities.sql');
const COMPANY_ID = 1;

// Jamal's "Add Responsibility" design, in its order.
const LIST = [
    ['Guest Help Desk', 'Assist guests with general queries'],
    ['Venue Guidance', 'Help guests find venues and areas'],
    ['RSVP Support', 'Handle guest confirmations'],
    ['Timing Coordination', 'Coordinate event timing and flow'],
    ['Family Assistance', 'Support family members and VIPs'],
    ['Emergency Support', 'Handle emergency situations'],
    ['Stage Coordination', 'Manage stage activities and flow'],
    ['Parking Support', 'Guide guests for parking'],
    ['Accommodation Help', 'Assist with stay and lodging'],
    ['Food / Catering Support', 'Help with dining and catering'],
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
        // 1. Column.
        const alter = fs.readFileSync(SQL_FILE, 'utf8')
            .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
            .split(';').map((s) => s.trim()).filter(Boolean)[0];
        const [[col]] = await conn.query(
            `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events' AND COLUMN_NAME = 'contact_responsibility_ids'`,
            [process.env.DB_NAME],
        );
        if (col.n) {
            console.log('  = events.contact_responsibility_ids   already exists');
        } else {
            console.log(`  + events.contact_responsibility_ids   ${APPLY ? 'adding' : 'WOULD ADD'}`);
            if (APPLY) await conn.query(alter);
        }

        // 2. The ten, per active category (one read, one write per category).
        const [cats] = await conn.query(
            `SELECT id, name FROM event_categories
             WHERE deleted_at IS NULL AND is_active = 1 AND company_id = ?`,
            [COMPANY_ID],
        );
        const [rows] = await conn.query(
            `SELECT id, event_category_id, name, description FROM event_responsibilities
             WHERE company_id = ? AND deleted_at IS NULL`,
            [COMPANY_ID],
        );
        for (const cat of cats) {
            const have = new Map(rows
                .filter((r) => Number(r.event_category_id) === Number(cat.id))
                .map((r) => [r.name.trim().toLowerCase(), r]));
            const inserts = [];
            const fills = [];
            LIST.forEach(([name, description], i) => {
                const row = have.get(name.toLowerCase());
                if (!row) inserts.push([cat.id, name, description, '', i + 1, 1, COMPANY_ID]);
                else if (!(row.description || '').trim()) fills.push([row.id, description]);
            });
            if (!inserts.length && !fills.length) {
                console.log(`  = ${cat.name} (${cat.id}): all ten present`);
                continue;
            }
            console.log(`  + ${cat.name} (${cat.id}): ${APPLY ? '' : 'WOULD '}add ${inserts.length}, fill ${fills.length} description(s)`);
            if (!APPLY) continue;
            if (inserts.length) {
                await conn.query(
                    `INSERT INTO event_responsibilities
                       (event_category_id, name, description, icon, sort_order, is_active, company_id)
                     VALUES ?`,
                    [inserts],
                );
            }
            if (fills.length) {
                await conn.query(
                    `UPDATE event_responsibilities
                     SET description = CASE id ${fills.map(() => 'WHEN ? THEN ?').join(' ')} END
                     WHERE id IN (?)`,
                    [...fills.flat(), fills.map(([id]) => id)],
                );
            }
        }
        if (!APPLY) console.log('\nDry run — add --apply to write.');
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
