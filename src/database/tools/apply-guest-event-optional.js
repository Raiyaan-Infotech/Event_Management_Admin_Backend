/**
 * `event_guests.event_id` becomes NULLABLE — a guest is a person on the
 * client's list, not a row owned by one event (§570).
 *
 * The FK stays: when an event_id IS set it must name a real event. MySQL
 * allows NULL on a FK column, so ON DELETE CASCADE still applies to the rows
 * that do name an event.
 *
 * Re-runnable: checks IS_NULLABLE first and does nothing when already applied.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const target = process.argv.includes('--prod') ? 'production' : 'local';

const parseEnv = (file) => {
    const fs = require('fs');
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

(async () => {
    const env = target === 'production'
        ? parseEnv('.env.production')
        : { DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER, DB_PASSWORD: process.env.DB_PASS ?? process.env.DB_PASSWORD, DB_NAME: process.env.DB_NAME, DB_SSL: 'false' };

    const conn = await mysql.createConnection({
        host: env.DB_HOST, port: env.DB_PORT || 3306, user: env.DB_USER,
        password: env.DB_PASSWORD, database: env.DB_NAME,
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });

    const [[col]] = await conn.query(
        `SELECT IS_NULLABLE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_guests' AND COLUMN_NAME = 'event_id'`,
        [env.DB_NAME]
    );
    if (!col) throw new Error('event_guests.event_id not found');

    if (col.IS_NULLABLE === 'YES') {
        console.log(`[${target}] already nullable — nothing to do.`);
    } else {
        await conn.query(
            "ALTER TABLE `event_guests` MODIFY `event_id` int unsigned NULL "
            + "COMMENT 'NULL = a general guest on the client list, not tied to an event'"
        );
        console.log(`[${target}] event_guests.event_id is now NULLABLE.`);
    }

    await conn.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
