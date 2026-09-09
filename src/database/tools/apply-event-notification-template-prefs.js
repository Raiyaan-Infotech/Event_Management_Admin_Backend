#!/usr/bin/env node
/**
 * Creates `event_notification_template_prefs` — a CLIENT's per-event
 * override of one admin notification template (on by default; a row exists
 * only once the client has actually toggled it off or back on). See
 * src/models/EventNotificationTemplatePref.js for the full rationale.
 *
 * Depends on `events` and `notification_templates` existing first.
 *
 * ── HOW TO RUN ─────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-event-notification-template-prefs.js
 *   node src/database/tools/apply-event-notification-template-prefs.js --apply
 *   node src/database/tools/apply-event-notification-template-prefs.js --prod --apply
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

const TABLE = 'event_notification_template_prefs';

async function tableExists(conn, table) {
    const [rows] = await conn.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_NAME, table],
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
        console.log(`  ${TABLE}`);
        if (await tableExists(conn, TABLE)) {
            console.log(`  = ${TABLE.padEnd(38)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${TABLE.padEnd(38)} WOULD CREATE`);
        } else {
            const clientIdType = await columnType(conn, 'website_clients', 'id');
            const eventIdType = await columnType(conn, 'events', 'id');
            const templateIdType = await columnType(conn, 'notification_templates', 'id');

            await conn.query(`
                CREATE TABLE \`${TABLE}\` (
                    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    \`website_client_id\` ${clientIdType} NOT NULL,
                    \`event_id\` ${eventIdType} NOT NULL,
                    \`notification_template_id\` ${templateIdType} NOT NULL,
                    \`enabled\` TINYINT(1) NOT NULL DEFAULT 1,
                    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (\`id\`),
                    UNIQUE KEY \`uniq_event_template_pref\` (\`event_id\`, \`notification_template_id\`),
                    KEY \`idx_event_template_pref_client\` (\`website_client_id\`),
                    CONSTRAINT \`fk_event_template_pref_client\`
                        FOREIGN KEY (\`website_client_id\`)
                        REFERENCES \`website_clients\` (\`id\`) ON DELETE CASCADE,
                    CONSTRAINT \`fk_event_template_pref_event\`
                        FOREIGN KEY (\`event_id\`)
                        REFERENCES \`events\` (\`id\`) ON DELETE CASCADE,
                    CONSTRAINT \`fk_event_template_pref_template\`
                        FOREIGN KEY (\`notification_template_id\`)
                        REFERENCES \`notification_templates\` (\`id\`) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log(`  + ${TABLE.padEnd(38)} created`);
        }

        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
