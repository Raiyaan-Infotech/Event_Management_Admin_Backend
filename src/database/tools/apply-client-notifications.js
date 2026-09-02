#!/usr/bin/env node
/**
 * Messaging Phase 1 — the client's notification feed.
 *
 *   client_notifications
 *
 * ── WHY A NEW TABLE AND NOT `mail_notifications` ────────────────────────────
 * `mail_notifications` is a read-flag hung off a row in `mails`: it cannot
 * exist without one, because its whole job is "this person has an unread mail".
 * This feed carries things that are not mail at all — an RSVP came in, an event
 * starts tomorrow, invitations finished going out. Forcing those through the
 * mail tables would mean inventing a `mails` row for each, and every mail screen
 * in three portals would then have to learn to hide them.
 *
 * ── `category` AND `type` ARE BOTH HERE ON PURPOSE ──────────────────────────
 * `category` is the small closed set the UI groups by — the tabs are RSVP,
 * Reminders, Messages, System. `type` is the specific thing that happened
 * ('rsvp_accepted', 'invitation_delivered'), which is what a preference in
 * `client_notification_prefs` switches on and what a future template keys off.
 * One column would force a choice between a tab list that grows forever and a
 * preference that cannot be specific.
 *
 * ── THE BODY IS RENDERED AT WRITE TIME, NOT READ TIME ───────────────────────
 * "Ananya Sharma accepted your invitation for Priya & Arjun Wedding" is stored
 * as text. Composing it on read would mean joining the guest and the event on
 * every feed page, and — worse — a notification would silently rewrite itself
 * when the guest was renamed or the event deleted. A notification is a record
 * of what was true when it fired.
 *
 * `event_id` and `guest_id` are still kept alongside it, nullable and
 * ON DELETE SET NULL, so the row can offer a link while it still resolves and
 * simply stop offering one when it does not.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-client-notifications.js
 *   node src/database/tools/apply-client-notifications.js --apply
 *   node src/database/tools/apply-client-notifications.js --prod --apply
 *
 * Dry runs by default; `--prod` dry-runs too until `--apply` is added.
 */

require('dotenv').config();
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

const TABLE = 'client_notifications';

/** Read, never guessed — see the six migrations that guessing cost. */
async function idType(conn, table, column = 'id') {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.DB_NAME, table, column],
    );
    if (!rows.length) throw new Error(`${table}.${column} not found — wrong database?`);
    return rows[0].COLUMN_TYPE.toUpperCase();
}

const ddl = (clientFk, eventFk, guestFk) => `
CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
  \`id\`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`website_client_id\` ${clientFk} NOT NULL,
  \`company_id\`        INT NULL,

  -- What the UI groups by. Closed set, because it is a tab bar.
  \`category\`  ENUM('rsvp','reminder','message','system','guest') NOT NULL DEFAULT 'system',
  -- What actually happened. Open, because a preference switches on it.
  \`type\`      VARCHAR(60)  NOT NULL,

  -- Rendered when it fired. A notification is a record of what was true then,
  -- so it must not rewrite itself when the guest is renamed.
  \`title\`     VARCHAR(200) NOT NULL,
  \`body\`      VARCHAR(500) NULL,

  -- Kept beside the text so the row can offer a link while it resolves, and
  -- stop offering one when it does not.
  \`event_id\`  ${eventFk} NULL,
  \`guest_id\`  ${guestFk} NULL,
  \`link\`      VARCHAR(255) NULL COMMENT 'In-app path the row opens. NULL = nothing to open.',
  \`meta\`      JSON NULL COMMENT 'Extra detail for the side panel. Never load-bearing.',

  \`is_read\`     TINYINT(1) NOT NULL DEFAULT 0,
  \`read_at\`     DATETIME NULL,
  -- Archive hides a row from the feed without destroying it: "seen and dealt
  -- with" and "never happened" are different answers.
  \`archived_at\` DATETIME NULL,

  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (\`id\`),
  -- The feed's own query: one client, unarchived, newest first.
  KEY \`idx_client_notifications_feed\` (\`website_client_id\`,\`archived_at\`,\`created_at\`),
  -- The unread badge, which runs on every page load and must not scan.
  KEY \`idx_client_notifications_unread\` (\`website_client_id\`,\`is_read\`,\`archived_at\`),
  KEY \`idx_client_notifications_category\` (\`website_client_id\`,\`category\`,\`archived_at\`),
  KEY \`idx_client_notifications_event\` (\`event_id\`),
  KEY \`idx_client_notifications_guest\` (\`guest_id\`),
  CONSTRAINT \`fk_client_notifications_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- SET NULL, not CASCADE: deleting an event must not erase the record that its
  -- invitations went out. The row keeps its text and loses its link.
  CONSTRAINT \`fk_client_notifications_event\`
    FOREIGN KEY (\`event_id\`) REFERENCES \`events\` (\`id\`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT \`fk_client_notifications_guest\`
    FOREIGN KEY (\`guest_id\`) REFERENCES \`event_guests\` (\`id\`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        const clientFk = await idType(conn, 'website_clients');
        const eventFk = await idType(conn, 'events');
        const guestFk = await idType(conn, 'event_guests');
        console.log(`  website_clients.id ${clientFk} · events.id ${eventFk} · event_guests.id ${guestFk}`);
        console.log('  foreign keys will match those exactly\n');

        const [existing] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [process.env.DB_NAME, TABLE],
        );

        if (existing.length) {
            console.log(`  = ${TABLE}     already present, skipping`);
        } else if (!APPLY) {
            console.log(`  + ${TABLE}     WOULD CREATE`);
        } else {
            await conn.query(ddl(clientFk, eventFk, guestFk));
            console.log(`  + ${TABLE}     created`);
        }

        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [process.env.DB_NAME, TABLE],
        );
        if (cols.length) console.log(`\n  ${TABLE}: ${cols.length} columns.\n`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
