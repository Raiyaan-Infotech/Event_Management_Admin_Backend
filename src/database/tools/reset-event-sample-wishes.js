#!/usr/bin/env node
/**
 * Replaces ALL Wed Wishes of one event with 5 fresh sample text wishes written
 * by the event's sample participants (website_clients 40, 45–48). Two of them
 * carry a blocked word that is already masked and flagged (as the content
 * filter would have saved them), so the Flagged tile / Hidden tab can be seen.
 *
 *   node src/database/tools/reset-event-sample-wishes.js                    dry run, local, event 30
 *   node src/database/tools/reset-event-sample-wishes.js --apply            write, local
 *   node src/database/tools/reset-event-sample-wishes.js --prod             dry run, production
 *   node src/database/tools/reset-event-sample-wishes.js --prod --apply     write, production
 *   node src/database/tools/reset-event-sample-wishes.js --prod --apply --event=12
 *
 * ⚠ Deletes every wish of the event (likes go with them) in one transaction.
 * Photo / video files of deleted wishes are NOT removed from storage — the
 * dry run says how many wishes carry media.
 */
require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');
const EVENT_ID = Number((args.find((a) => a.startsWith('--event=')) || '--event=30').split('=')[1]);

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

// author = website_clients id; hoursAgo spreads the times; flagged = masked by the filter
const WISHES = [
    { author: 45, audience: 'both', hoursAgo: 2, message: 'Wishing you both a lifetime of love, laughter and happiness. Congratulations!' },
    { author: 46, audience: 'groom', hoursAgo: 9, message: 'So happy for you, brother! May your journey together be beautiful.' },
    { author: 47, audience: 'bride', hoursAgo: 20, message: 'You look radiant! Wishing you a wonderful married life full of joy.' },
    { author: 48, audience: 'both', hoursAgo: 30, flagged: true, message: 'Only a *** person would miss this wedding. Cannot wait to celebrate!' },
    { author: 40, audience: 'both', hoursAgo: 44, flagged: true, message: 'Do not listen to the *** rumours, you two are perfect together.' },
];

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
        const [[event]] = await conn.query(
            'SELECT id, website_client_id, company_id FROM events WHERE id = ?', [EVENT_ID]);
        if (!event) throw new Error(`Event #${EVENT_ID} not found.`);

        const [[cur]] = await conn.query(
            `SELECT COUNT(*) AS wishes,
                    SUM(post_type <> 'text' OR photo IS NOT NULL) AS with_media
               FROM event_wishes WHERE event_id = ?`, [EVENT_ID]);
        console.log(`Will delete ${cur.wishes} wish(es) (${cur.with_media || 0} with a photo/video file left in storage).`);

        const ids = WISHES.map((w) => w.author);
        const [clients] = await conn.query(
            'SELECT id, name, mobile FROM website_clients WHERE id IN (?)', [ids]);
        const byId = new Map(clients.map((c) => [c.id, c]));
        for (const w of WISHES) {
            if (!byId.has(w.author)) throw new Error(`website_clients #${w.author} not found.`);
            const c = byId.get(w.author);
            console.log(`  + ${c.name} (${w.audience}${w.flagged ? ', flagged+hidden' : ''}): ${w.message}`);
        }

        if (!APPLY) return console.log('\nDry run — nothing written. Add --apply to write.');

        await conn.beginTransaction();
        try {
            await conn.query('DELETE FROM event_wishes WHERE event_id = ?', [EVENT_ID]);
            const created = [];
            for (const w of WISHES) {
                const c = byId.get(w.author);
                const [r] = await conn.query(
                    `INSERT INTO event_wishes
                       (event_id, website_client_id, company_id, author_client_id, guest_name, mobile,
                        message, post_type, audience, is_hidden, is_flagged, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'text', ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? HOUR))`,
                    [EVENT_ID, event.website_client_id, event.company_id, w.author, c.name, c.mobile,
                        w.message, w.audience, w.flagged ? 1 : 0, w.flagged ? 1 : 0, w.hoursAgo],
                );
                created.push({ id: r.insertId, author: w.author });
            }
            // a few likes from the other sample participants
            for (const [i, wish] of created.entries()) {
                for (const liker of ids.filter((x) => x !== wish.author).slice(0, (i % 3) + 1)) {
                    await conn.query('INSERT INTO event_wish_likes (wish_id, client_id) VALUES (?, ?)', [wish.id, liker]);
                }
            }
            await conn.commit();
            console.log(`\nDone — wishes ${created.map((c) => '#' + c.id).join(', ')}.`);
        } catch (e) {
            await conn.rollback();
            throw e;
        }
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
});
