#!/usr/bin/env node
/**
 * Everything push notifications need that the schema does not already have.
 *
 *   client_device_tokens              the ADDRESS to send to
 *   event_messages.channel += 'push'  so a per-recipient row can be a push
 *   event_message_campaigns           the push-only composer fields
 *
 * ── WHY THIS EXTENDS THE MESSAGE TABLES INSTEAD OF ADDING NEW ONES ──────────
 * A `push_notifications` + `push_notification_recipients` pair was the obvious
 * sketch. It was dropped after reading what is already here:
 *
 *   event_message_campaigns  already has audience / group_ids / guest_ids /
 *                            recipients_count / status / scheduled_at /
 *                            sent_at, and its `channel` ENUM ALREADY LISTS
 *                            'push' — somebody planned for this
 *   event_messages           already has one row per recipient with
 *                            sent_at / delivered_at / opened_at / clicked_at,
 *                            which IS the Sent/Delivered/Opened/Clicked/Failed
 *                            row of cards on the mockup
 *   clientMessage.service    already resolves All / Groups / Specific guests,
 *                            already refuses a schedule in the past, already
 *                            lists campaigns and computes stats
 *
 * A parallel pair of tables would have duplicated all of that, and then split
 * "messages sent to this guest" across two places that the Analytics screen
 * would have to union forever. Push is a CHANNEL, not a separate product.
 *
 * ── ⚠ A DEVICE TOKEN BELONGS TO A DEVICE, NOT A SESSION ────────────────────
 * The token was very nearly a column on `client_sessions`. That is wrong twice
 * over: a person signs out and back in (new session, same device, same token —
 * a duplicate row), and a session expires while the app stays installed (a
 * live device with no reachable token). FCM's own identity is the token, so
 * the token is the primary key of the idea and gets its own table, `UNIQUE` on
 * the token itself. Re-registering the same token UPDATEs rather than inserts.
 *
 * ── WHY `is_active` AND NOT A DELETE ───────────────────────────────────────
 * FCM answers UNREGISTERED for a token whose app was uninstalled. That is a
 * fact worth keeping: it is the honest reason a recipient shows Failed. A
 * deleted row would leave the failure unexplained.
 *
 * ── HOW TO RUN ─────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-push-notification-support.js
 *   node src/database/tools/apply-push-notification-support.js --apply
 *   node src/database/tools/apply-push-notification-support.js --prod --apply
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

const TOKENS = 'client_device_tokens';

async function tableExists(conn, table) {
    const [rows] = await conn.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_NAME, table],
    );
    return rows.length > 0;
}

async function hasColumn(conn, table, column) {
    const [rows] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.DB_NAME, table, column],
    );
    return rows.length > 0;
}

async function columnType(conn, table, column) {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.DB_NAME, table, column],
    );
    if (!rows.length) throw new Error(`${table}.${column} not found — wrong database?`);
    return rows[0].COLUMN_TYPE.toUpperCase();
}

/**
 * Columns the composer needs that no message channel needed before.
 *
 * `push_options` is one JSON column rather than a dozen scalars on purpose:
 * sound, badge mode, badge number, priority, TTL, collapse key, content
 * available and restricted package name are all FCM's vocabulary, not ours.
 * Giving each a column would mean a migration every time FCM adds a field, and
 * would put eleven always-NULL columns on every email campaign ever sent.
 */
const CAMPAIGN_COLUMNS = [
    ['image_url', "VARCHAR(500) NULL COMMENT 'Notification image (FCM notification.image)'"],
    ['click_action', "VARCHAR(30) NULL COMMENT 'open_app | deep_link | custom'"],
    ['deep_link', "VARCHAR(500) NULL COMMENT 'Screen to open when tapped'"],
    ['data_payload', "JSON NULL COMMENT 'Additional key/value data sent with the notification'"],
    ['push_options', "JSON NULL COMMENT 'Sound, badge, priority, TTL, delivery options'"],
];

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: PROD ? { rejectUnauthorized: false } : undefined,
    });

    console.log('');
    console.log(`  database : ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(`  mode     : ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to write)'}`);
    console.log('');

    try {
        /* ── 1. client_device_tokens ─────────────────────────────────────── */

        console.log(`  ${TOKENS}`);
        if (await tableExists(conn, TOKENS)) {
            console.log(`  = ${TOKENS.padEnd(38)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${TOKENS.padEnd(38)} WOULD CREATE`);
        } else {
            const ownerType = await columnType(conn, 'website_clients', 'id');
            await conn.query(`
                CREATE TABLE \`${TOKENS}\` (
                    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    \`website_client_id\` ${ownerType} NOT NULL,
                    \`token\` VARCHAR(255) NOT NULL,
                    \`platform\` ENUM('android','ios','web') NOT NULL DEFAULT 'android',
                    \`device_name\` VARCHAR(120) NULL,
                    \`app_version\` VARCHAR(40) NULL,
                    \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
                    \`disabled_reason\` VARCHAR(120) NULL,
                    \`last_seen_at\` DATETIME NULL,
                    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (\`id\`),
                    UNIQUE KEY \`uniq_device_token\` (\`token\`),
                    KEY \`idx_device_token_client\` (\`website_client_id\`, \`is_active\`),
                    CONSTRAINT \`fk_device_token_client\`
                        FOREIGN KEY (\`website_client_id\`)
                        REFERENCES \`website_clients\` (\`id\`) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log(`  + ${TOKENS.padEnd(38)} created`);
        }

        /* ── 2. event_messages.channel += 'push' ─────────────────────────── */

        console.log('');
        console.log('  event_messages.channel');
        const msgChannel = await columnType(conn, 'event_messages', 'channel');
        if (msgChannel.includes("'PUSH'") || msgChannel.includes('PUSH')) {
            console.log(`  = ${"channel ENUM includes 'push'".padEnd(38)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${"channel ENUM += 'push'".padEnd(38)} WOULD ALTER`);
        } else {
            await conn.query(
                `ALTER TABLE \`event_messages\`
                   MODIFY COLUMN \`channel\` ENUM('whatsapp','email','sms','push') NOT NULL`,
            );
            console.log(`  + ${"channel ENUM += 'push'".padEnd(38)} altered`);
        }

        /* ── 3. event_message_campaigns composer columns ─────────────────── */

        console.log('');
        console.log('  event_message_campaigns');
        for (const [column, definition] of CAMPAIGN_COLUMNS) {
            if (await hasColumn(conn, 'event_message_campaigns', column)) {
                console.log(`  = ${column.padEnd(38)} already present`);
            } else if (!APPLY) {
                console.log(`  + ${column.padEnd(38)} WOULD ADD`);
            } else {
                await conn.query(
                    `ALTER TABLE \`event_message_campaigns\` ADD COLUMN \`${column}\` ${definition}`,
                );
                console.log(`  + ${column.padEnd(38)} added`);
            }
        }

        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
