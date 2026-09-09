#!/usr/bin/env node
/**
 * Creates `notification_templates` — admin-authored transactional message
 * blueprints (RSVP Confirmation, Event Reminder, ...), scoped by notification
 * category / event category / event type, meant to be picked up later by
 * system-triggered sends. See `src/services/notificationTemplate.service.js`.
 *
 * Depends on `notification_categories` existing first — run
 * apply-notification-categories.js before this one.
 *
 * ── HOW TO RUN ─────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-notification-categories.js --apply
 *   node src/database/tools/apply-notification-templates.js
 *   node src/database/tools/apply-notification-templates.js --apply
 *   node src/database/tools/apply-notification-templates.js --prod --apply
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

const TABLE = 'notification_templates';

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
            const notifCategoryIdType = await columnType(conn, 'notification_categories', 'id');
            const categoryIdType = await columnType(conn, 'event_categories', 'id');
            const typeIdType = await columnType(conn, 'event_types', 'id');

            await conn.query(`
                CREATE TABLE \`${TABLE}\` (
                    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    \`name\` VARCHAR(150) NOT NULL,
                    \`notification_category_id\` ${notifCategoryIdType} NOT NULL,
                    \`event_category_id\` ${categoryIdType} NULL,
                    \`event_type_id\` ${typeIdType} NULL,
                    \`title\` VARCHAR(100) NOT NULL,
                    \`content\` TEXT NOT NULL,
                    \`variables_used\` JSON NULL,
                    \`image_url\` VARCHAR(500) NULL,
                    \`channels\` JSON NOT NULL,
                    \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
                    \`sort_order\` INT NOT NULL DEFAULT 0,
                    \`company_id\` INT UNSIGNED NULL,
                    \`created_by\` INT UNSIGNED NULL,
                    \`updated_by\` INT UNSIGNED NULL,
                    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,
                    \`deleted_at\` DATETIME NULL,
                    PRIMARY KEY (\`id\`),
                    KEY \`idx_notification_templates_category\` (\`notification_category_id\`, \`is_active\`),
                    KEY \`idx_notification_templates_event_category\` (\`event_category_id\`),
                    KEY \`idx_notification_templates_event_type\` (\`event_type_id\`),
                    CONSTRAINT \`fk_notification_templates_notification_category\`
                        FOREIGN KEY (\`notification_category_id\`)
                        REFERENCES \`notification_categories\` (\`id\`),
                    CONSTRAINT \`fk_notification_templates_event_category\`
                        FOREIGN KEY (\`event_category_id\`)
                        REFERENCES \`event_categories\` (\`id\`) ON DELETE SET NULL,
                    CONSTRAINT \`fk_notification_templates_event_type\`
                        FOREIGN KEY (\`event_type_id\`)
                        REFERENCES \`event_types\` (\`id\`) ON DELETE SET NULL
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
