/**
 * Adds the two columns the organizer's RSVP module needs.
 *
 *   events.rsvp_settings          json NULL
 *     One event's RSVP form as the organizer configured it (the app's Edit
 *     Event → RSVP screen): enabled, response_options, deadline,
 *     allow_guest_count, allow_special_requests, allow_relationship.
 *     NULL = never configured = the defaults (see clientRsvpSettings.service).
 *
 *   event_participants.rsvp_side  enum('groom','bride') NULL
 *     The guest's answer to "Are you from the Groom's side or the Bride's
 *     side?" on the RSVP form. NULL = not asked / not answered. The
 *     relationship itself reuses the existing `relationship` +
 *     `relationship_option_id` columns.
 *
 *   node src/database/tools/apply-rsvp-settings.js            (dry run, local)
 *   node src/database/tools/apply-rsvp-settings.js --apply
 *   node src/database/tools/apply-rsvp-settings.js --prod --apply
 *
 * ⚠ Run on production BEFORE deploying the backend that reads the columns: the
 * Event and EventParticipant models select them, so every event and guest
 * query fails until they exist.
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const COLUMNS = [
    {
        table: 'events',
        column: 'rsvp_settings',
        ddl: `ALTER TABLE \`events\`
  ADD COLUMN \`rsvp_settings\` json DEFAULT NULL COMMENT 'The organizer''s RSVP form settings; NULL = the defaults. See apply-rsvp-settings.js' AFTER \`qr_style\`;`,
    },
    {
        table: 'event_participants',
        column: 'rsvp_side',
        ddl: `ALTER TABLE \`event_participants\`
  ADD COLUMN \`rsvp_side\` enum('groom','bride') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'RSVP answer: groom''s side or bride''s side. NULL = not asked / not answered' AFTER \`relationship_option_id\`;`,
    },
];

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const l of raw.split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

(async () => {
    const env = PROD ? parseEnv('.env.production') : localEnv;
    const conn = await mysql.createConnection({
        host: env.DB_HOST,
        port: env.DB_PORT || 3306,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        charset: 'utf8mb4',
        ssl: PROD && env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : undefined,
    });

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}`);

    const missing = [];
    for (const c of COLUMNS) {
        const [[row]] = await conn.query(
            `SELECT COUNT(*) n FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [c.table, c.column]
        );
        console.log(`${c.table}.${c.column}: ${row.n ? 'present' : 'TO ADD'}`);
        if (!row.n) missing.push(c);
    }

    if (!missing.length) {
        console.log('Nothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    for (const c of missing) {
        await conn.query(c.ddl);
        console.log(`${c.table}.${c.column} added.`);
    }
    await conn.end();
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
