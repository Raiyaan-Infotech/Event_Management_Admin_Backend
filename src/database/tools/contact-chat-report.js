#!/usr/bin/env node
/**
 * Read-only: why a Contact Person chat shows Online / Offline and whether the
 * offline auto reply was sent. Writes nothing.
 *
 *   node src/database/tools/contact-chat-report.js --id 34          local
 *   node src/database/tools/contact-chat-report.js --id 34 --prod   production
 *   node src/database/tools/contact-chat-report.js --name fathima --prod
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const PROD = args.includes('--prod');
let ID = Number(opt('--id'));
const NAME = opt('--name');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

// Same rules as eventOrganizer.service: last 10 digits, online = seen < 3 min.
const national = (raw) => {
    const d = String(raw || '').replace(/\D/g, '');
    return d.length >= 7 ? d.slice(-10) : null;
};
const ONLINE_MS = 3 * 60 * 1000;

(async () => {
    if (!ID && !NAME) { console.log('Give --id <event id> or --name <text>.'); process.exit(1); }
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  (read only)\n`);

    try {
        if (!ID) {
            const [found] = await conn.query('SELECT id FROM events WHERE name LIKE ? AND deleted_at IS NULL ORDER BY id DESC', [`%${NAME}%`]);
            if (found.length !== 1) { console.log(`  ${found.length} events match "${NAME}": ${found.map((r) => r.id).join(', ')} - use --id`); return; }
            ID = found[0].id;
        }
        const [[ev]] = await conn.query(
            'SELECT e.id, e.name, e.organizer, e.contact_phone, e.website_client_id, c.mobile AS owner_mobile, c.vendor_id '
            + 'FROM events e LEFT JOIN website_clients c ON c.id = e.website_client_id WHERE e.id = ?',
            [ID],
        );
        if (!ev) { console.log('  no such event'); return; }
        const contact = national(ev.contact_phone);
        const number = contact || national(ev.owner_mobile);
        console.log(`  Event #${ev.id} "${ev.name}"`);
        console.log(`  Contact person: ${ev.organizer || '(none)'}  contact_phone: ${ev.contact_phone || '(empty)'}`);
        console.log(`  Owner client #${ev.website_client_id} mobile: ${ev.owner_mobile}`);
        console.log(`  Number checked for Online: ${number}${contact ? '' : '  (no contact phone -> OWNER\'s number)'}`);

        const [[seen]] = await conn.query(
            'SELECT last_seen_at FROM contact_person_logins WHERE vendor_id = ? AND mobile = ?',
            [ev.vendor_id, number],
        );
        const ago = seen?.last_seen_at ? Math.round((Date.now() - new Date(seen.last_seen_at).getTime()) / 1000) : null;
        console.log(`  Last seen: ${seen?.last_seen_at || 'never'}${ago != null ? `  (${ago}s ago)` : ''}`);
        console.log(`  => right now the chat would say: ${ago != null && ago * 1000 < ONLINE_MS ? 'ONLINE (no auto reply)' : 'OFFLINE (auto reply)'}`);

        const [[same]] = await conn.query(
            "SELECT id, name FROM website_clients WHERE vendor_id = ? AND RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', ''), 10) = ? LIMIT 1",
            [ev.vendor_id, number],
        );
        if (same) console.log(`  ! that number is also client #${same.id} "${same.name}" - ANY use of the app by them counts as online`);

        const [chats] = await conn.query(
            'SELECT ch.id, ch.participant_client_id, w.name, w.mobile, ch.status FROM event_contact_chats ch '
            + 'LEFT JOIN website_clients w ON w.id = ch.participant_client_id WHERE ch.event_id = ?',
            [ID],
        );
        if (!chats.length) console.log('\n  No participant chats on this event yet (nothing was sent).');
        for (const ch of chats) {
            const pn = national(ch.mobile);
            console.log(`\n  Chat #${ch.id} with participant #${ch.participant_client_id} "${ch.name}" (${ch.mobile}) [${ch.status}]`
                + (pn && pn === number ? '  ! participant IS the contact number - always online while chatting' : ''));
            const [msgs] = await conn.query(
                'SELECT sender_side, is_auto, created_at, LEFT(body, 60) AS body FROM event_contact_chat_messages '
                + 'WHERE chat_id = ? ORDER BY id DESC LIMIT 8',
                [ch.id],
            );
            for (const m of msgs.reverse()) {
                console.log(`    ${new Date(m.created_at).toISOString()}  ${m.is_auto ? 'AUTO' : m.sender_side.padEnd(11)}  ${m.body}`);
            }
        }
    } finally {
        await conn.end();
    }
})().catch((e) => { console.error(e.message); process.exit(1); });
