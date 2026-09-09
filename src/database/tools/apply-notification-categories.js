#!/usr/bin/env node
/**
 * Creates `notification_categories` — master data for the "Notification
 * Category" dropdown on Notification Templates (Event & Invitation, RSVP &
 * Participation, Schedule & Reminder, System). Admin-managed rather than a
 * hardcoded ENUM, same reasoning as `event_categories`: renaming or adding
 * one would otherwise need a code deploy.
 *
 * Seeds the four categories shown in the supplied mockups on first create —
 * skipped (not re-inserted) once any row already exists.
 *
 * ── HOW TO RUN ─────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-notification-categories.js
 *   node src/database/tools/apply-notification-categories.js --apply
 *   node src/database/tools/apply-notification-categories.js --prod --apply
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

const TABLE = 'notification_categories';

const SEED_ROWS = [
    ['Event & Invitation', 'Welcome messages, invitations, venue and schedule updates', 1],
    ['RSVP & Participation', 'RSVP confirmations, updates and cancellations', 2],
    ['Schedule & Reminder', 'Event reminders and anniversary/occasion reminders', 3],
    ['System', 'System-generated messages such as new message alerts', 4],
];

async function tableExists(conn, table) {
    const [rows] = await conn.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_NAME, table],
    );
    return rows.length > 0;
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
        const exists = await tableExists(conn, TABLE);

        if (exists) {
            console.log(`  = ${TABLE.padEnd(38)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${TABLE.padEnd(38)} WOULD CREATE`);
        } else {
            await conn.query(`
                CREATE TABLE \`${TABLE}\` (
                    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    \`name\` VARCHAR(100) NOT NULL,
                    \`description\` TEXT NULL,
                    \`icon\` VARCHAR(100) NULL DEFAULT '',
                    \`color\` VARCHAR(20) NULL,
                    \`sort_order\` INT NOT NULL DEFAULT 0,
                    \`is_active\` TINYINT NOT NULL DEFAULT 1,
                    \`company_id\` INT UNSIGNED NULL,
                    \`created_by\` INT UNSIGNED NULL,
                    \`updated_by\` INT UNSIGNED NULL,
                    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,
                    \`deleted_at\` DATETIME NULL,
                    PRIMARY KEY (\`id\`),
                    KEY \`idx_notification_categories_listing\` (\`company_id\`, \`deleted_at\`, \`is_active\`, \`sort_order\`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log(`  + ${TABLE.padEnd(38)} created`);
        }

        console.log('');
        console.log('  seed rows');
        const [existingCount] = await conn.query(`SELECT COUNT(*) AS c FROM \`${TABLE}\``).catch(() => [[{ c: 0 }]]);
        const hasRows = exists && existingCount[0].c > 0;

        if (hasRows) {
            console.log(`  = ${'default categories'.padEnd(38)} rows already present, skipped`);
        } else if (!APPLY) {
            console.log(`  + ${'default categories'.padEnd(38)} WOULD INSERT ${SEED_ROWS.length} rows`);
        } else {
            for (const [name, description, sortOrder] of SEED_ROWS) {
                await conn.query(
                    `INSERT INTO \`${TABLE}\` (name, description, sort_order, is_active, created_at, updated_at)
                     VALUES (?, ?, ?, 1, NOW(), NOW())`,
                    [name, description, sortOrder],
                );
            }
            console.log(`  + ${'default categories'.padEnd(38)} inserted ${SEED_ROWS.length} rows`);
        }

        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
