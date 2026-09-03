#!/usr/bin/env node
/**
 * Splash Screens — a standalone module, not yet tied to an event.
 *
 *   splash_screens
 *
 * ── ⚠ NOT PER-EVENT YET, DELIBERATELY ───────────────────────────────────────
 * The supplied design breadcrumbs this as "Back to Event Setup," which reads
 * like a step of creating one event. It isn't, on purpose: this round builds
 * the module and its CRUD on their own — `event_name` is a plain text field
 * a client types, not a foreign key — and linking a saved splash to a real
 * `events` row is an explicitly later phase. No `event_id` column exists yet;
 * adding one later is a normal migration, and it is far cheaper to add a
 * missing FK than to unpick one that was guessed wrong.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────────
 * The MOBILE APP's own splash / loading screen, shown when a guest opens an
 * event inside `Event_Invite_Mobile_App` — not a web page. There is no public
 * web route for this, and none is being added here.
 *
 * ── WHY TWO COLUMNS PLUS FOUR JSON CONFIG BLOBS, NOT FORTY FLAT COLUMNS ─────
 * `background_type` picks ONE of six wildly different shapes (a video's start
 * point and volume have nothing in common with a gradient's two colours and a
 * direction). `background_config` holds whichever shape applies; the three
 * independent add-ons (sound / loader / animation) get their own JSON blobs
 * because each is optional on top of ANY background type, not a variant of it.
 * This mirrors `events.components` / `component_order` already in this schema
 * — JSON for flexible per-type shape, plain columns for what every row has.
 *
 * ── ⚠ ANIMATION IS SAVED, NOT DELIVERED ─────────────────────────────────────
 * The mock's own copy says "Animations will be visible in the mobile app
 * only" — and the app has no splash-rendering screen to read this yet. Saved
 * now on purpose (the day the app can read it, nothing needs re-entering),
 * same pattern as this project's email/notification consent flags: recorded
 * correctly, not yet acted on, and the API says so rather than a component
 * quietly assuming it works.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-splash-screens.js
 *   node src/database/tools/apply-splash-screens.js --apply
 *   node src/database/tools/apply-splash-screens.js --prod --apply
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

/** Read, never guessed — see §313.3 and the six migrations that guessing cost. */
async function clientIdType(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'id'`,
        [process.env.DB_NAME],
    );
    if (!rows.length) throw new Error('website_clients.id not found — wrong database?');
    return rows[0].COLUMN_TYPE.toUpperCase();
}

const table = (fk) => `
CREATE TABLE IF NOT EXISTS \`splash_screens\` (
  \`id\`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`website_client_id\`   ${fk} NOT NULL,
  \`company_id\`          INT NULL,

  -- An internal label for the list — this is what identifies one saved splash
  -- among several, since it is not (yet) tied to one event's own name.
  \`name\`                VARCHAR(150) NOT NULL,

  -- Content
  \`main_title\`          VARCHAR(60)  NOT NULL,
  \`sub_title\`           VARCHAR(20)  NULL,
  -- Plain text today — see the header. Not a foreign key until events are wired up.
  \`event_name\`          VARCHAR(100) NOT NULL,
  \`tagline\`             VARCHAR(150) NULL,

  -- Background — ONE of six shapes, picked by type
  \`background_type\`     ENUM('image','video','solid_color','gradient','logo','couple_photo')
                          NOT NULL DEFAULT 'image',
  \`background_url\`      VARCHAR(500) NULL COMMENT 'The uploaded image / video / logo / couple photo, depending on background_type',
  \`fallback_image_url\`  VARCHAR(500) NULL COMMENT 'Video background only — shown before/if the video cannot play',
  \`background_config\`   JSON NULL COMMENT 'Type-specific knobs: overlay %, video start/volume, gradient colors/direction, logo size/position, photo fit/dark-overlay, solid colour hex',

  -- Sound — independent add-on, not a background type
  \`sound_enabled\`       TINYINT(1) NOT NULL DEFAULT 0,
  \`sound_url\`           VARCHAR(500) NULL,
  \`sound_config\`        JSON NULL COMMENT 'auto_play, loop, volume',

  -- Loader — independent add-on
  \`loader_enabled\`      TINYINT(1) NOT NULL DEFAULT 1,
  \`loader_config\`       JSON NULL COMMENT 'style, color, size, background color',

  -- Animation — independent add-on. ⚠ SAVED, NOT DELIVERED — see header.
  \`animation_enabled\`   TINYINT(1) NOT NULL DEFAULT 0,
  \`animation_config\`    JSON NULL COMMENT 'style, speed, particle density, overlay color/opacity, loop — mobile-app-only, unread until the app has a splash screen',

  -- Button
  \`button_text\`         VARCHAR(25)  NOT NULL DEFAULT 'Enter Invitation',
  \`button_style\`        ENUM('filled','outline','text') NOT NULL DEFAULT 'filled',
  \`button_color\`        VARCHAR(9)   NULL,

  -- Additional toggles
  \`show_couple_name\`    TINYINT(1) NOT NULL DEFAULT 1,
  \`show_event_date\`     TINYINT(1) NOT NULL DEFAULT 1,
  \`show_tagline\`        TINYINT(1) NOT NULL DEFAULT 1,

  -- Save as Draft vs Save & Continue
  \`status\`              ENUM('draft','active') NOT NULL DEFAULT 'draft',

  \`created_at\`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`deleted_at\`          DATETIME NULL,

  PRIMARY KEY (\`id\`),
  KEY \`splash_screens_client\` (\`website_client_id\`, \`deleted_at\`),
  CONSTRAINT \`fk_splash_screens_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE
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
        const fk = await clientIdType(conn);
        console.log(`  website_clients.id is ${fk} — foreign key will match it\n`);

        const [existing] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'splash_screens'`,
            [process.env.DB_NAME],
        );

        if (existing.length) {
            console.log('  = splash_screens      already present, skipping');
        } else if (!APPLY) {
            console.log('  + splash_screens      WOULD CREATE');
        } else {
            await conn.query(table(fk));
            console.log('  + splash_screens      created');
        }

        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'splash_screens'`,
            [process.env.DB_NAME],
        );
        if (cols.length) console.log(`\n  ${cols.length} columns.\n`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
