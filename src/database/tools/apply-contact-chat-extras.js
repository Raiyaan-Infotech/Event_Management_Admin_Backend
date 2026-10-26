#!/usr/bin/env node
/**
 * Contact Person chat, round 2 (2026-10-26): 'removed' status, is_auto
 * messages, contact_person_logins.last_seen_at
 * (src/database/migrations/sql/20261026-contact-chat-extras.sql).
 *
 * Re-runnable: each change is made only when missing.
 *
 *   node src/database/tools/apply-contact-chat-extras.js                  dry run, local
 *   node src/database/tools/apply-contact-chat-extras.js --apply          local
 *   node src/database/tools/apply-contact-chat-extras.js --prod           dry run, production
 *   node src/database/tools/apply-contact-chat-extras.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend.
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);
    const col = async (table, column) => {
        const [[r]] = await conn.query(
            `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [process.env.DB_NAME, table, column],
        );
        return r ? r.t : null;
    };
    const step = async (label, needed, sql) => {
        console.log(needed ? `  + ${label.padEnd(44)} ${APPLY ? 'applying' : 'WOULD APPLY'}` : `  = ${label.padEnd(44)} already done`);
        if (needed && APPLY) await conn.query(sql);
    };
    try {
        const status = await col('event_contact_chats', 'status');
        if (status === null) throw new Error('event_contact_chats is missing — run apply-event-contact-chats.js first.');
        await step("event_contact_chats.status + 'removed'", !status.includes("'removed'"),
            "ALTER TABLE event_contact_chats MODIFY status ENUM('open','resolved','blocked','removed') NOT NULL DEFAULT 'open'");
        await step('event_contact_chat_messages.is_auto', !(await col('event_contact_chat_messages', 'is_auto')),
            'ALTER TABLE event_contact_chat_messages ADD COLUMN is_auto TINYINT(1) NOT NULL DEFAULT 0 AFTER body');
        await step('contact_person_logins.last_seen_at', !(await col('contact_person_logins', 'last_seen_at')),
            'ALTER TABLE contact_person_logins ADD COLUMN last_seen_at DATETIME NULL AFTER last_login_at');
        if (!APPLY) console.log('\nDry run — add --apply to write.');
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
