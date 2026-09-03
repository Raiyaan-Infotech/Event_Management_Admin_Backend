#!/usr/bin/env node
/**
 * Migration: push_notification_configs
 *
 * Stores Firebase Push Notification project credentials and routing configuration
 * for Super Admin and the client portal.
 *
 * Usage:
 *   node src/database/tools/apply-push-notification-configs.js
 *   node src/database/tools/apply-push-notification-configs.js --apply
 *   node src/database/tools/apply-push-notification-configs.js --prod --apply
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

const TABLE = 'push_notification_configs';

async function main() {
    const config = {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    };

    console.log(`Connecting to ${config.user}@${config.host}:${config.port}/${config.database} (${PROD ? 'PRODUCTION' : 'LOCAL'})…`);
    const conn = await mysql.createConnection(config);

    try {
        const [existing] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [config.database, TABLE],
        );

        if (existing.length > 0) {
            console.log(`Table '${TABLE}' already exists. Checking structure...`);
            const [cols] = await conn.query(
                `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [config.database, TABLE],
            );
            console.log(`Columns present (${cols.length}):`, cols.map(c => c.COLUMN_NAME).join(', '));
            return;
        }

        const createSql = `
            CREATE TABLE \`${TABLE}\` (
                \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                \`name\` VARCHAR(100) NOT NULL,
                \`is_active\` TINYINT(1) NOT NULL DEFAULT 0,
                \`service_account_json\` LONGTEXT NULL,
                \`project_id\` VARCHAR(255) NULL,
                \`client_email\` VARCHAR(255) NULL,
                \`private_key\` TEXT NULL,
                \`web_api_key\` VARCHAR(255) NULL,
                \`app_id\` VARCHAR(255) NULL,
                \`messaging_sender_id\` VARCHAR(255) NULL,
                \`auth_domain\` VARCHAR(255) NULL,
                \`storage_bucket\` VARCHAR(255) NULL,
                \`measurement_id\` VARCHAR(255) NULL,
                \`vapid_key\` VARCHAR(255) NULL,
                \`connection_status\` ENUM('connected', 'disconnected', 'pending', 'error') NOT NULL DEFAULT 'pending',
                \`last_verified_at\` DATETIME NULL,
                \`validation_error\` TEXT NULL,
                \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`),
                INDEX \`idx_push_config_active\` (\`is_active\`),
                INDEX \`idx_push_config_project_id\` (\`project_id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;

        if (!APPLY) {
            console.log(`[DRY RUN] Would execute CREATE TABLE \`${TABLE}\`:\n${createSql}`);
            console.log(`Run with --apply to execute.`);
            return;
        }

        console.log(`Creating table \`${TABLE}\`…`);
        await conn.query(createSql);
        console.log(`Table \`${TABLE}\` created successfully!`);
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
