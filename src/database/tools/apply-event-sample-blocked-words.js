#!/usr/bin/env node
/**
 * Adds sample blocked words to an event's Wed Wishes content filter
 * (`events.wish_settings.filter`), so a replaced word + flagged post can be
 * checked in the feed. Data only, no schema change.
 *
 *   node src/database/tools/apply-event-sample-blocked-words.js                      dry run, local, event 30
 *   node src/database/tools/apply-event-sample-blocked-words.js --apply              write, local
 *   node src/database/tools/apply-event-sample-blocked-words.js --prod               dry run, production
 *   node src/database/tools/apply-event-sample-blocked-words.js --prod --apply       write, production
 *   node src/database/tools/apply-event-sample-blocked-words.js --prod --apply --event=12
 *
 * Re-runnable: a word already in the list is not added again, and the event's
 * other wish_settings are kept.
 */
require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');
const EVENT_ID = Number((args.find((a) => a.startsWith('--event=')) || '--event=30').split('=')[1]);

const WORDS = ['stupid', 'idiot', 'fake', 'spam'];
const REPLACE = '***';

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASS || process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: PROD ? { rejectUnauthorized: false } : undefined,
    });
    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'} (${process.env.DB_NAME}) — ${APPLY ? 'APPLY' : 'dry run'} — event #${EVENT_ID}`);

    try {
        const [rows] = await conn.query('SELECT id, name, wish_settings FROM events WHERE id = ?', [EVENT_ID]);
        if (!rows.length) throw new Error(`Event #${EVENT_ID} not found.`);

        let settings = rows[0].wish_settings;
        if (typeof settings === 'string') settings = JSON.parse(settings);
        settings = settings || {};

        const filter = settings.filter || {};
        const words = Array.isArray(filter.words) ? [...filter.words] : [];
        const added = [];
        for (const w of WORDS) {
            if (!words.some((x) => String(x?.word || '').toLowerCase() === w)) {
                words.push({ word: w, replace: REPLACE });
                added.push(w);
            }
        }
        settings.filter = { auto_hide: true, notify: true, ...filter, enabled: true, words };

        console.log('Before:', JSON.stringify(filter));
        console.log('Adding:', added.length ? added.join(', ') : '(all already there)');
        console.log('After: ', JSON.stringify(settings.filter));

        if (!APPLY) return console.log('\nDry run — nothing written. Add --apply to write.');
        await conn.query('UPDATE events SET wish_settings = ? WHERE id = ?', [JSON.stringify(settings), EVENT_ID]);
        console.log('\nDone.');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
});
