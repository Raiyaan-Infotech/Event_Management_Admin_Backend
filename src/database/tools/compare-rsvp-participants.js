/**
 * READ-ONLY. Why do the RSVP screen and the Participants screen disagree?
 * (session §593)
 *
 * Both read `event_participants` for one host. They can still differ through
 * the DATA, so this prints every way a row can be counted by one and not the
 * other:
 *
 *   no_event        event_id NULL — leftover phone-book rows (§572/§581). The
 *                   RSVP list always hid them; Participants showed them until
 *                   §593.
 *   host_mismatch   row's website_client_id is not the event's owner. The portal
 *                   (scoped by website_client_id) and the app (scoped by
 *                   event_id) then show different people.
 *   deleted_event   row still live on a soft-deleted event.
 *   status_clash    rsvp_status and response_type disagree (e.g. accepted +
 *                   none): tiles bucket by one, filters/labels by the other.
 *
 * and, per event, rows vs heads (party_size) and joined-by-app — the RSVP page
 * leads with rows ("Total Invitations"), Participants with heads ("Total
 * Guests"), and the app's Participants shows JOINED people only.
 *
 *   node src/database/tools/compare-rsvp-participants.js          (local)
 *   node src/database/tools/compare-rsvp-participants.js --prod
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PROD = process.argv.includes('--prod');

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
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}  (read-only)\n`);

    // ONE query per section (production is ~370ms a query).
    const [hosts] = await conn.query(`
        SELECT p.website_client_id AS host,
               COUNT(*) AS rows_live,
               SUM(p.event_id IS NULL) AS no_event,
               SUM(p.event_id IS NOT NULL AND e.id IS NOT NULL AND e.website_client_id <> p.website_client_id) AS host_mismatch,
               SUM(e.deleted_at IS NOT NULL) AS deleted_event,
               SUM((p.rsvp_status = 'accepted' AND p.response_type <> 'yes')
                OR (p.rsvp_status = 'declined' AND p.response_type <> 'no')
                OR (p.rsvp_status = 'pending'  AND p.response_type <> 'maybe')
                OR (p.rsvp_status IN ('invited','not_responded') AND p.response_type <> 'none')) AS status_clash
          FROM event_participants p
          LEFT JOIN events e ON e.id = p.event_id
         WHERE p.deleted_at IS NULL
         GROUP BY p.website_client_id
         ORDER BY p.website_client_id`);
    console.log('PER HOST — anything non-zero after rows_live is a cause');
    console.table(hosts.map((h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]))));

    const [events] = await conn.query(`
        SELECT e.id AS event, e.website_client_id AS owner, LEFT(e.name, 24) AS name,
               COUNT(p.id) AS rsvp_rows_total_invitations,
               COALESCE(SUM(p.party_size), 0) AS heads_total_guests,
               SUM(p.participant_client_id IS NOT NULL) AS joined_app_participants,
               SUM(p.rsvp_status = 'accepted') AS accepted,
               SUM(p.rsvp_status = 'pending') AS maybe,
               SUM(p.rsvp_status = 'declined') AS declined,
               SUM(p.rsvp_status IN ('invited','not_responded')) AS no_response
          FROM events e
          LEFT JOIN event_participants p ON p.event_id = e.id AND p.deleted_at IS NULL
         WHERE e.deleted_at IS NULL
         GROUP BY e.id
         ORDER BY e.id`);
    console.log('\nPER EVENT — RSVP page "Total Invitations" = rows; portal Participants "Total Guests" = heads;');
    console.log('app Participants screen = joined only');
    console.table(events.map((e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, k === 'name' ? v : Number(v)]))));

    const [clashes] = await conn.query(`
        SELECT id, event_id, website_client_id AS host, LEFT(name, 24) AS name, rsvp_status, response_type, party_size
          FROM event_participants
         WHERE deleted_at IS NULL AND (
               (rsvp_status = 'accepted' AND response_type <> 'yes')
            OR (rsvp_status = 'declined' AND response_type <> 'no')
            OR (rsvp_status = 'pending'  AND response_type <> 'maybe')
            OR (rsvp_status IN ('invited','not_responded') AND response_type <> 'none'))
         ORDER BY id LIMIT 50`);
    if (clashes.length) {
        console.log('\nSTATUS CLASHES (first 50)');
        console.table(clashes);
    }

    await conn.end();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
