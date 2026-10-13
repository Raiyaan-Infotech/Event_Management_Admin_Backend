#!/usr/bin/env node
/**
 * Adds `events.organizer_client_id` — the login account of the event's ONE
 * organizer (the holder of the phone number on the Organizer page). See
 * src/services/eventOrganizer.service.js.
 *
 *   node src/database/tools/apply-event-organizer-client.js              dry run, local
 *   node src/database/tools/apply-event-organizer-client.js --apply      write, local
 *   node src/database/tools/apply-event-organizer-client.js --prod       dry run, production
 *   node src/database/tools/apply-event-organizer-client.js --prod --apply
 *
 * Idempotent. Adds the column, its index and its foreign key (SET NULL: an
 * organizer's account being deleted must not take the event with it). No rows
 * are filled — an event is linked when its organizer's number is saved again
 * or signs in.
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

const TABLE = 'events';
const COLUMN = 'organizer_client_id';
const INDEX = 'idx_events_organizer';
const FK = 'fk_events_organizer_client';

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
        // The foreign key must match website_clients.id exactly, signedness included.
        const [idRows] = await conn.query(
            `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'id'`,
            [process.env.DB_NAME],
        );
        if (!idRows.length) throw new Error('website_clients.id not found — wrong database?');
        const idType = idRows[0].COLUMN_TYPE.toUpperCase();

        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [process.env.DB_NAME, TABLE, COLUMN],
        );
        if (cols.length) {
            console.log(`  = ${COLUMN}   already present`);
        } else if (!APPLY) {
            console.log(`  + ${COLUMN}   WOULD ADD  (${idType} NULL, after website_client_id)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD COLUMN \`${COLUMN}\` ${idType} NULL
                   COMMENT 'The login account of the event''s one organizer (the holder of contact_phone). NULL = the owner only'
                   AFTER \`website_client_id\``,
            );
            console.log(`  + ${COLUMN}   added`);
        }

        const [idx] = await conn.query(
            `SELECT INDEX_NAME FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
            [process.env.DB_NAME, TABLE, INDEX],
        );
        if (idx.length) {
            console.log(`  = ${INDEX}   already present`);
        } else if (!APPLY) {
            console.log(`  + ${INDEX}   WOULD ADD`);
        } else {
            await conn.query(`ALTER TABLE \`${TABLE}\` ADD KEY \`${INDEX}\` (\`${COLUMN}\`,\`deleted_at\`)`);
            console.log(`  + ${INDEX}   added`);
        }

        const [fks] = await conn.query(
            `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
            [process.env.DB_NAME, TABLE, FK],
        );
        if (fks.length) {
            console.log(`  = ${FK}   already present`);
        } else if (!APPLY) {
            console.log(`  + ${FK}   WOULD ADD  (-> website_clients.id, ON DELETE SET NULL)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD CONSTRAINT \`${FK}\` FOREIGN KEY (\`${COLUMN}\`)
                   REFERENCES \`website_clients\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE`,
            );
            console.log(`  + ${FK}   added`);
        }
        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
