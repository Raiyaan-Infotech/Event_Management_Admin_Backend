#!/usr/bin/env node
/**
 * Settings Phase 2 — the two tables the client portal's Preferences and
 * Notifications screens need.
 *
 *   client_preferences         one row per client: display, locale and the
 *                              two master switches + Do Not Disturb window
 *   client_notification_prefs  one row per (client, channel, type)
 *
 * ── WHY THE NOTIFICATION TABLE IS NARROW, NOT WIDE ──────────────────────────
 * The obvious shape is a column per notification type. It is also the shape
 * that needs a MIGRATION every time somebody adds a notification, and this
 * codebase has paid for that already. Keyed by `(channel, type)` a new type is
 * a row, and the catalogue in the service is the only place that changes.
 *
 * ── WHAT THESE TABLES DO NOT DO YET ─────────────────────────────────────────
 * ⚠ Nothing sends. `email_configs` has 0 rows — no SMTP is configured anywhere
 * — and this portal has no in-app notification feed (the header bell is a
 * hardcoded empty state; `mail_notifications` belongs to `vendor_clients`, the
 * older portal). These tables record CONSENT so it is already correct on the
 * day delivery is wired, which is the decision taken deliberately rather than
 * by accident. The screens say so; see clientPreferences.service.js.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-client-preferences.js
 *   node src/database/tools/apply-client-preferences.js --apply
 *   node src/database/tools/apply-client-preferences.js --prod
 *   node src/database/tools/apply-client-preferences.js --prod --apply
 *
 * Dry runs by default, and `--prod` dry-runs too until `--apply` is added.
 * CREATE TABLE IF NOT EXISTS, so a re-run is a no-op.
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

/**
 * The FK column type is READ from `website_clients.id`, never written here.
 *
 * `website_clients.id` is INT UNSIGNED today; guessing INT once already cost
 * this codebase a round of failed migrations (the signedness mismatch is not
 * reported as a type error, it is reported as errno 150 with no detail).
 */
async function clientIdType(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'id'`,
        [process.env.DB_NAME],
    );
    if (!rows.length) throw new Error('website_clients.id not found — wrong database?');
    return rows[0].COLUMN_TYPE.toUpperCase();
}

const tables = (fk) => [
    {
        name: 'client_preferences',
        sql: `
CREATE TABLE IF NOT EXISTS \`client_preferences\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`website_client_id\` ${fk} NOT NULL,

  -- Locale. \`language_code\` is a code, not an FK: the \`languages\` table is the
  -- ADMIN panel's and holds exactly one row, so a constraint against it would
  -- tie a client's own preference to a table they have nothing to do with.
  \`language_code\`     VARCHAR(10)  NOT NULL DEFAULT 'en',
  \`date_format\`       VARCHAR(20)  NOT NULL DEFAULT 'DD/MM/YYYY',
  \`time_zone\`         VARCHAR(64)  NOT NULL DEFAULT 'Asia/Kolkata',

  -- Display.
  \`theme\`             ENUM('light','dark','system') NOT NULL DEFAULT 'system',
  \`default_landing\`   VARCHAR(40)  NOT NULL DEFAULT 'dashboard',
  \`items_per_page\`    SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  \`compact_mode\`      TINYINT(1)   NOT NULL DEFAULT 0,
  \`auto_save\`         TINYINT(1)   NOT NULL DEFAULT 1,
  \`show_tips\`         TINYINT(1)   NOT NULL DEFAULT 1,

  -- Master switches. Kept HERE and not as a notification row, because they are
  -- not a notification type — they override every row of their channel, and a
  -- row that means "all the other rows" invites being read as just another one.
  \`emails_disabled\`   TINYINT(1)   NOT NULL DEFAULT 0,
  \`in_app_disabled\`   TINYINT(1)   NOT NULL DEFAULT 0,

  -- Do Not Disturb is stored as a WINDOW, not as a boolean plus a duration.
  -- A boolean has to be switched off by something, and the only thing that
  -- could is a scheduled job — which §314 established does not reliably run
  -- here. Two timestamps answer "is it quiet right now?" by comparison, so it
  -- expires correctly whether or not anything is running.
  \`dnd_starts_at\`     DATETIME     NULL,
  \`dnd_ends_at\`       DATETIME     NULL,

  \`created_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (\`id\`),
  -- One row per client, enforced by the database and not by the service.
  UNIQUE KEY \`client_preferences_client\` (\`website_client_id\`),
  CONSTRAINT \`fk_client_preferences_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
        name: 'client_notification_prefs',
        sql: `
CREATE TABLE IF NOT EXISTS \`client_notification_prefs\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`website_client_id\` ${fk} NOT NULL,

  -- 'sms' is deliberately NOT in this enum. There is no SMS provider (the
  -- mobile OTP is logged with "NOT SENT — no SMS provider"), and an enum value
  -- nothing ever writes reads as a channel that exists.
  \`channel\`           ENUM('email','in_app') NOT NULL,

  -- The catalogue in clientPreferences.service.js is the source of truth for
  -- what a valid type is; the column is a VARCHAR so adding one is a row and
  -- not an ALTER.
  \`type\`              VARCHAR(60)  NOT NULL,
  \`enabled\`           TINYINT(1)   NOT NULL DEFAULT 1,

  -- Email only. NULL on in-app rows rather than a filler value, so "this
  -- channel has no frequency" and "the client chose instant" stay distinct.
  \`frequency\`         VARCHAR(30)  NULL,

  -- In-app only, same reasoning inverted.
  \`sound\`             TINYINT(1)   NULL,

  \`created_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`client_notification_prefs_slot\` (\`website_client_id\`, \`channel\`, \`type\`),
  KEY \`client_notification_prefs_lookup\` (\`website_client_id\`, \`channel\`, \`enabled\`),
  CONSTRAINT \`fk_client_notification_prefs_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE
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
        const fk = await clientIdType(conn);
        console.log(`  website_clients.id is ${fk} — foreign keys will match it\n`);

        const [existing] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('client_preferences','client_notification_prefs')`,
            [process.env.DB_NAME],
        );
        const have = new Set(existing.map((r) => r.TABLE_NAME));

        for (const t of tables(fk)) {
            if (have.has(t.name)) {
                console.log(`  = ${t.name.padEnd(28)} already present, skipping`);
                continue;
            }
            if (!APPLY) {
                console.log(`  + ${t.name.padEnd(28)} WOULD CREATE`);
                continue;
            }
            await conn.query(t.sql);
            console.log(`  + ${t.name.padEnd(28)} created`);
        }

        const [after] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('client_preferences','client_notification_prefs')`,
            [process.env.DB_NAME],
        );
        console.log(`\n  present now: ${after.map((r) => r.TABLE_NAME).join(', ') || '(none)'}\n`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
