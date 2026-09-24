/**
 * Rename the participant tables so the names say what they hold (§583).
 *
 * After the phone-book split (§581) `event_guests` held ONLY participants — the
 * people attending one event — yet still said "guests", which sat next to the
 * real `guests` table and read as a second phone book. Every table that follows
 * a guest or a participant is renamed to match:
 *
 *   event_guests                 → event_participants
 *   event_guest_response_logs    → event_participant_response_logs
 *   event_guest_groups           → guest_groups           (groups organise GUESTS)
 *   event_guest_notes            → guest_notes            (host notes are about a GUEST)
 *   event_guest_tags             → guest_tags
 *   event_guest_reminders        → guest_reminders
 *
 * and the columns that pointed at a participant say so:
 *
 *   event_messages.guest_id                        → participant_id
 *   event_participant_response_logs.guest_id       → participant_id
 *   client_notifications.guest_id                  → participant_id
 *
 * `event_participants.guest_id` (the phone-book guest a participant is) and
 * `guest_notes|tags|reminders.guest_id` (the guest a note is about) are correct
 * as they are.
 *
 * ── SAFE TO RUN ──────────────────────────────────────────────────────────────
 * RENAME TABLE and RENAME COLUMN carry their foreign keys with them, so no data
 * moves. Every step checks first, so a re-run is a no-op. FK and index NAMES keep
 * their old text (`fk_event_guests_client` …): MySQL cannot rename a constraint
 * in place, they are invisible to the app, and re-creating each one on a live
 * database is risk for no behavioural gain.
 *
 *   node src/database/tools/apply-participants-rename.js                  local, dry run
 *   node src/database/tools/apply-participants-rename.js --apply          local
 *   node src/database/tools/apply-participants-rename.js --prod --apply   production
 */
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const target = PROD ? 'production' : 'local';

const parseEnv = (file) => {
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

const TABLES = [
    ['event_guests', 'event_participants'],
    ['event_guest_response_logs', 'event_participant_response_logs'],
    ['event_guest_groups', 'guest_groups'],
    ['event_guest_notes', 'guest_notes'],
    ['event_guest_tags', 'guest_tags'],
    ['event_guest_reminders', 'guest_reminders'],
];

// [table AFTER the rename above, old column, new column]
const COLUMNS = [
    ['event_messages', 'guest_id', 'participant_id'],
    ['event_participant_response_logs', 'guest_id', 'participant_id'],
    ['client_notifications', 'guest_id', 'participant_id'],
];

(async () => {
    const env = PROD
        ? parseEnv('.env.production')
        : {
            DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER,
            DB_PASSWORD: process.env.DB_PASS ?? process.env.DB_PASSWORD, DB_NAME: process.env.DB_NAME, DB_SSL: 'false',
        };

    const conn = await mysql.createConnection({
        host: env.DB_HOST, port: env.DB_PORT || 3306, user: env.DB_USER,
        password: env.DB_PASSWORD, database: env.DB_NAME,
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });
    const q = async (sql, params) => (await conn.query(sql, params))[0];
    const say = (msg) => console.log(`[${target}${APPLY ? '' : ' · dry run'}] ${msg}`);

    const tableExists = async (t) =>
        (await q('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [env.DB_NAME, t])).length > 0;
    const columnExists = async (t, c) =>
        (await q('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [env.DB_NAME, t, c])).length > 0;

    // ── tables ──────────────────────────────────────────────────────────────
    for (const [from, to] of TABLES) {
        if (await tableExists(to)) { say(`${to} already exists`); continue; }
        if (!(await tableExists(from))) { say(`⚠ neither ${from} nor ${to} exists — skipped`); continue; }
        if (!APPLY) { say(`would: rename ${from} → ${to}`); continue; }
        await q(`RENAME TABLE \`${from}\` TO \`${to}\``);
        say(`renamed ${from} → ${to}`);
    }

    // ── columns ─────────────────────────────────────────────────────────────
    for (const [table, from, to] of COLUMNS) {
        // In a dry run the table still has its old name.
        const t = (await tableExists(table)) ? table : table.replace('event_participant_response_logs', 'event_guest_response_logs');
        if (await columnExists(t, to)) { say(`${t}.${to} already exists`); continue; }
        if (!(await columnExists(t, from))) { say(`⚠ ${t}.${from} not found — skipped`); continue; }
        if (!APPLY) { say(`would: ${t}.${from} → ${to}`); continue; }
        await q(`ALTER TABLE \`${t}\` RENAME COLUMN \`${from}\` TO \`${to}\``);
        say(`${t}.${from} → ${to}`);
    }

    // ── report ──────────────────────────────────────────────────────────────
    const has = (t) => tableExists(t);
    if (await has('event_participants')) {
        const [p] = await q('SELECT COUNT(*) n FROM `event_participants`');
        const [g] = await q('SELECT COUNT(*) n FROM `guests`');
        say(`now: guests ${g.n} · event_participants ${p.n}`);
    }
    await conn.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
