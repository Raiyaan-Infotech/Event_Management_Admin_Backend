#!/usr/bin/env node
/**
 * Guests become event-based (2026-10-28):
 *   1. adds `guests.event_id` + `guests.invited_at`
 *      (src/database/migrations/sql/20261028-guests-event-based.sql), and
 *   2. with --event=<id>, moves that event OWNER's guests that have no event
 *      onto it and marks them invited now (Jamal: Ismail's 50 guests → the
 *      Syed wedding, all "Invited").
 *
 * Without --event it only lists, per owner with unlinked guests, their events —
 * so the right id can be picked. Re-runnable: columns are added only when
 * missing; only guests with event_id NULL are moved.
 *
 *   node src/database/tools/apply-guests-event-based.js                          dry run, local
 *   node src/database/tools/apply-guests-event-based.js --apply                  local (columns only)
 *   node src/database/tools/apply-guests-event-based.js --apply --event=85       local, move guests
 *   node src/database/tools/apply-guests-event-based.js --prod                   dry run, production
 *   node src/database/tools/apply-guests-event-based.js --prod --apply --event=N production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend (the Guest model
 * reads the new columns).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');
const EVENT_ID = Number((args.find((a) => a.startsWith('--event=')) || '').split('=')[1]) || null;

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261028-guests-event-based.sql');

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
        // 1. Columns.
        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'guests' AND COLUMN_NAME IN ('event_id', 'invited_at')`,
            [process.env.DB_NAME],
        );
        const have = new Set(cols.map((c) => c.COLUMN_NAME));
        if (have.has('event_id') && have.has('invited_at')) {
            console.log('  = guests.event_id / invited_at   already there');
        } else if (have.size) {
            throw new Error(`guests has only ${[...have].join(', ')} — fix by hand, the SQL adds both.`);
        } else {
            console.log(`  + guests.event_id / invited_at   ${APPLY ? 'adding' : 'WOULD ADD'}`);
            if (APPLY) {
                const sql = fs.readFileSync(SQL_FILE, 'utf8')
                    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
                    .split(';').map((s) => s.trim()).filter(Boolean)[0];
                await conn.query(sql);
            }
        }

        // 2. Unlinked guests, per owner, and that owner's events.
        const eventCol = have.has('event_id') || APPLY;
        const [owners] = await conn.query(
            `SELECT g.website_client_id AS owner, c.name, COUNT(*) AS n
               FROM guests g JOIN website_clients c ON c.id = g.website_client_id
              WHERE g.deleted_at IS NULL ${eventCol ? 'AND g.event_id IS NULL' : ''}
              GROUP BY g.website_client_id, c.name`,
        );
        if (!owners.length) console.log('  (no guests without an event)');
        for (const o of owners) {
            const [events] = await conn.query(
                'SELECT id, name, start_date FROM events WHERE website_client_id = ? AND deleted_at IS NULL ORDER BY id DESC',
                [o.owner],
            );
            console.log(`\n  owner #${o.owner} ${o.name}: ${o.n} guest(s) with no event. Events:`);
            for (const e of events) console.log(`     #${e.id}  ${e.name}  (${e.start_date || 'no date'})`);
        }

        // 3. Move onto the chosen event.
        if (EVENT_ID) {
            const [[event]] = await conn.query(
                'SELECT id, name, website_client_id FROM events WHERE id = ? AND deleted_at IS NULL',
                [EVENT_ID],
            );
            if (!event) throw new Error(`Event #${EVENT_ID} not found.`);
            if (!eventCol) throw new Error('Run with --apply to add the columns first.');
            const [[cnt]] = await conn.query(
                'SELECT COUNT(*) AS n FROM guests WHERE website_client_id = ? AND event_id IS NULL AND deleted_at IS NULL',
                [event.website_client_id],
            );
            console.log(`\n  → ${cnt.n} guest(s) of owner #${event.website_client_id} onto #${event.id} "${event.name}", invited now`
                + (APPLY ? '' : '   (dry run — nothing written)'));
            if (APPLY && cnt.n) {
                const [res] = await conn.query(
                    `UPDATE guests SET event_id = ?, invited_at = UTC_TIMESTAMP()
                      WHERE website_client_id = ? AND event_id IS NULL AND deleted_at IS NULL`,
                    [event.id, event.website_client_id],
                );
                console.log(`  ✓ moved ${res.affectedRows}`);
            }
        }
        console.log('\nDone.\n');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('\n✗', e.message);
    process.exit(1);
});
