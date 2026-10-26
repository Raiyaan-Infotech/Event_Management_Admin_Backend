#!/usr/bin/env node
/**
 * Contact Person chat (2026-10-26): creates event_contact_chats and
 * event_contact_chat_messages
 * (src/database/migrations/sql/20261026-event-contact-chats.sql).
 *
 * Re-runnable: CREATE TABLE IF NOT EXISTS.
 *
 *   node src/database/tools/apply-event-contact-chats.js                  dry run, local
 *   node src/database/tools/apply-event-contact-chats.js --apply          local
 *   node src/database/tools/apply-event-contact-chats.js --prod           dry run, production
 *   node src/database/tools/apply-event-contact-chats.js --prod --apply   production
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}
const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261026-event-contact-chats.sql');

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);
    try {
        for (const t of ['event_contact_chats', 'event_contact_chat_messages']) {
            const [[r]] = await conn.query(
                'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
                [process.env.DB_NAME, t],
            );
            console.log(r.n ? `  = ${t.padEnd(30)} already exists` : `  + ${t.padEnd(30)} ${APPLY ? 'creating' : 'WOULD CREATE'}`);
        }
        if (APPLY) {
            const sql = fs.readFileSync(SQL_FILE, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
            await conn.query(sql);
            console.log('    done');
        } else {
            console.log('\nDry run — add --apply to write.');
        }
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
