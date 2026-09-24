/**
 * `subscription_plans.max_rsvp_per_event` — the plan's RSVP ceiling (§571).
 *
 * Separate from `max_guests_per_event`: a GUEST is a phone-book contact on the
 * account, an RSVP is one person attending one event — including somebody who
 * scanned the QR on the day and was never in the guest list.
 *
 * Existing plans are seeded from `max_guests_per_event`, which is the number
 * the RSVP cap used before this column existed, so behaviour does not change
 * on the day it is applied.
 *
 * Re-runnable: checks the column first and does nothing when already applied.
 */
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

const target = process.argv.includes('--prod') ? 'production' : 'local';

const parseEnv = (file) => {
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
        : {
            DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER,
            DB_PASSWORD: process.env.DB_PASS ?? process.env.DB_PASSWORD, DB_NAME: process.env.DB_NAME, DB_SSL: 'false',
        };

    const conn = await mysql.createConnection({
        host: env.DB_HOST, port: env.DB_PORT || 3306, user: env.DB_USER,
        password: env.DB_PASSWORD, database: env.DB_NAME,
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });

    const [[col]] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'subscription_plans' AND COLUMN_NAME = 'max_rsvp_per_event'`,
        [env.DB_NAME]
    );

    if (col) {
        console.log(`[${target}] max_rsvp_per_event already exists — nothing to do.`);
    } else {
        await conn.query(
            "ALTER TABLE `subscription_plans` ADD COLUMN `max_rsvp_per_event` int unsigned NULL "
            + "COMMENT 'People attending ONE event (QR scanners included); NULL = unlimited' "
            + "AFTER `max_guests_per_event`"
        );
        const [res] = await conn.query(
            'UPDATE `subscription_plans` SET `max_rsvp_per_event` = `max_guests_per_event` '
            + 'WHERE `max_guests_per_event` IS NOT NULL'
        );
        console.log(`[${target}] column added; seeded ${res.affectedRows} plan(s) from max_guests_per_event.`);
    }

    const [plans] = await conn.query(
        'SELECT id, name, max_guests_per_event, max_rsvp_per_event FROM `subscription_plans` WHERE deleted_at IS NULL ORDER BY id'
    );
    console.table(plans);
    await conn.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
