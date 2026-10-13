#!/usr/bin/env node
/**
 * Creates `event_notifications` + `event_notification_recipients` — the
 * organizer's notifications from the mobile app (Home → Send Notification).
 *
 *   node src/database/tools/apply-event-notifications.js              dry run, local
 *   node src/database/tools/apply-event-notifications.js --apply      write, local
 *   node src/database/tools/apply-event-notifications.js --prod       dry run, production
 *   node src/database/tools/apply-event-notifications.js --prod --apply
 *
 * Idempotent: a table that is already there is skipped. The same two tables
 * are in `initial_setup.sql`.
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

/** Foreign keys must match the referenced column exactly, signedness included. */
async function idType(conn, table, column = 'id') {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.DB_NAME, table, column],
    );
    if (!rows.length) throw new Error(`${table}.${column} not found — wrong database?`);
    return rows[0].COLUMN_TYPE.toUpperCase();
}

const tables = (clientFk, eventFk, participantFk) => [
    {
        name: 'event_notifications',
        ddl: `
CREATE TABLE IF NOT EXISTS \`event_notifications\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`event_id\`          ${eventFk} NOT NULL,
  \`website_client_id\` ${clientFk} NOT NULL COMMENT 'the organizer who wrote it',
  \`company_id\`        INT NULL,
  \`title\`             VARCHAR(100) NOT NULL,
  \`message\`           VARCHAR(500) NULL COMMENT 'NULL only on a draft',
  \`image_url\`         VARCHAR(500) NULL,
  \`audience\`          ENUM('all','specific','groups') NOT NULL DEFAULT 'all',
  \`participant_ids\`   JSON NULL COMMENT 'event_participants.id list — audience specific',
  \`sides\`             JSON NULL COMMENT 'bride / groom — audience groups; both = every side',
  \`relationships\`     JSON NULL COMMENT 'relation names — audience groups; empty = every relation',
  \`channels\`          JSON NULL COMMENT 'push today',
  \`status\`            ENUM('draft','scheduled','sending','sent','failed') NOT NULL DEFAULT 'draft',
  \`scheduled_at\`      DATETIME NULL COMMENT 'the instant it goes out',
  \`timezone\`          VARCHAR(80) NULL COMMENT 'the label the organizer picked; scheduled_at is read in it',
  \`sent_at\`           DATETIME NULL,
  \`recipients_count\`  INT UNSIGNED NOT NULL DEFAULT 0,
  \`delivered_count\`   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'participants a device of whose accepted the push',
  \`failed_count\`      INT UNSIGNED NOT NULL DEFAULT 0,
  \`failed_reason\`     VARCHAR(255) NULL,
  \`created_at\`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`deleted_at\`        DATETIME NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_event_notifications_event\` (\`event_id\`,\`deleted_at\`,\`created_at\`),
  KEY \`idx_event_notifications_client\` (\`website_client_id\`,\`deleted_at\`),
  -- The scheduler's query, every minute.
  KEY \`idx_event_notifications_due\` (\`status\`,\`scheduled_at\`),
  CONSTRAINT \`fk_event_notifications_event\`
    FOREIGN KEY (\`event_id\`) REFERENCES \`events\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`fk_event_notifications_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
        name: 'event_notification_recipients',
        ddl: `
CREATE TABLE IF NOT EXISTS \`event_notification_recipients\` (
  \`id\`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`notification_id\`       INT UNSIGNED NOT NULL,
  \`event_id\`              ${eventFk} NOT NULL,
  \`participant_id\`        ${participantFk} NOT NULL,
  \`participant_client_id\` ${clientFk} NULL COMMENT 'their app account; NULL = has not joined the app',
  \`status\`                ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued' COMMENT 'the push only — the row exists either way',
  \`failed_reason\`         VARCHAR(255) NULL,
  \`sent_at\`               DATETIME NULL,
  \`is_read\`               TINYINT(1) NOT NULL DEFAULT 0,
  \`read_at\`               DATETIME NULL,
  \`created_at\`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uniq_event_notification_recipient\` (\`notification_id\`,\`participant_id\`),
  -- A participant's own list of what they were sent, newest first.
  KEY \`idx_event_notification_recipients_client\` (\`participant_client_id\`,\`event_id\`,\`created_at\`),
  KEY \`idx_event_notification_recipients_participant\` (\`participant_id\`),
  KEY \`idx_event_notification_recipients_event\` (\`event_id\`),
  CONSTRAINT \`fk_event_notification_recipients_notification\`
    FOREIGN KEY (\`notification_id\`) REFERENCES \`event_notifications\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`fk_event_notification_recipients_event\`
    FOREIGN KEY (\`event_id\`) REFERENCES \`events\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`fk_event_notification_recipients_participant\`
    FOREIGN KEY (\`participant_id\`) REFERENCES \`event_participants\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`fk_event_notification_recipients_client\`
    FOREIGN KEY (\`participant_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
];

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
        const participantFk = await idType(conn, 'event_participants');
        console.log(`  website_clients.id ${clientFk} · events.id ${eventFk} · event_participants.id ${participantFk}`);
        console.log('  foreign keys will match those exactly\n');

        for (const table of tables(clientFk, eventFk, participantFk)) {
            /* eslint-disable no-await-in-loop */
            const [existing] = await conn.query(
                `SELECT TABLE_NAME FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [process.env.DB_NAME, table.name],
            );
            if (existing.length) {
                console.log(`  = ${table.name}     already present, skipping`);
            } else if (!APPLY) {
                console.log(`  + ${table.name}     WOULD CREATE`);
            } else {
                await conn.query(table.ddl);
                console.log(`  + ${table.name}     created`);
            }
            /* eslint-enable no-await-in-loop */
        }
        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
