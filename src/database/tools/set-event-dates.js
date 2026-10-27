#!/usr/bin/env node
/**
 * Lists events matching a name and, with --apply, moves their start / end dates.
 * Times are left as they are unless --start-time / --end-time are given.
 *
 *   node src/database/tools/set-event-dates.js --name syed --prod
 *       dry run: lists matching events on production
 *   node src/database/tools/set-event-dates.js --name syed --start 2026-10-27 --end 2026-11-30 --prod --apply
 *   node src/database/tools/set-event-dates.js --id 30 --start 2026-10-27 --end 2026-11-30 --prod --apply
 *
 * Optional: --start-time 00:00 --end-time 23:59
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
const NAME = opt('--name');
const ID = opt('--id');
const START = opt('--start');
const END = opt('--end');
const START_TIME = opt('--start-time');
const END_TIME = opt('--end-time');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const isTime = (v) => /^\d{2}:\d{2}(:\d{2})?$/.test(v || '');

(async () => {
    if (!NAME && !ID) {
        console.log('Give --name <text> or --id <event id>.');
        process.exit(1);
    }
    if (APPLY) {
        if (!isDate(START) || !isDate(END)) { console.log('--apply needs --start and --end as YYYY-MM-DD.'); process.exit(1); }
        if (START > END) { console.log('--start is after --end.'); process.exit(1); }
        if ((START_TIME && !isTime(START_TIME)) || (END_TIME && !isTime(END_TIME))) {
            console.log('Times must be HH:MM.'); process.exit(1);
        }
    }

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        dateStrings: true,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);

    try {
        const [rows] = ID
            ? await conn.query('SELECT id, name, status, start_date, end_date, start_time, end_time FROM events WHERE id = ? AND deleted_at IS NULL', [ID])
            : await conn.query('SELECT id, name, status, start_date, end_date, start_time, end_time FROM events WHERE name LIKE ? AND deleted_at IS NULL', [`%${NAME}%`]);

        if (!rows.length) { console.log('  no matching events'); return; }
        for (const r of rows) {
            console.log(`  #${r.id} "${r.name}" [${r.status}]  ${r.start_date} ${r.start_time || ''} -> ${r.end_date} ${r.end_time || ''}`);
        }
        if (!APPLY) {
            if (START || END) console.log(`\n  WOULD SET ${START} -> ${END}${START_TIME ? ` (start ${START_TIME})` : ''}${END_TIME ? ` (end ${END_TIME})` : ''}`);
            return;
        }

        const ids = rows.map((r) => r.id);
        const sets = ['start_date = ?', 'end_date = ?'];
        const vals = [START, END];
        if (START_TIME) { sets.push('start_time = ?'); vals.push(START_TIME); }
        if (END_TIME) { sets.push('end_time = ?'); vals.push(END_TIME); }
        // A draft stays a draft; cancelled stays cancelled; only dates move.
        const [res] = await conn.query(
            `UPDATE events SET ${sets.join(', ')}, updated_at = NOW() WHERE id IN (?)`,
            [...vals, ids],
        );
        console.log(`\n  updated ${res.affectedRows} event(s) to ${START} -> ${END}`);
    } finally {
        await conn.end();
    }
})().catch((e) => { console.error(e.message); process.exit(1); });
