/**
 * Schema report for the client-portal tables.
 *
 * Prints every table this portal added, its columns, its indexes and its
 * foreign keys — and flags indexes that are missing or redundant. Run it
 * against local and production to see exactly what has and has not shipped.
 *
 *   node scratch/report_client_schema.js
 *   node scratch/report_client_schema.js prod
 */
require('dotenv').config({
    path: process.argv.includes('prod') ? '.env.production' : '.env',
});
const mysql = require('mysql2/promise');

const TARGET = process.argv.includes('prod') ? 'PRODUCTION' : 'LOCAL';

/** Every table the client portal owns, in dependency order. */
const TABLES = [
    'events',
    'event_guest_groups',
    'event_guests',
    'event_message_campaigns',
    'event_messages',
];

/**
 * Columns that SHOULD be indexed, and why.
 *
 * A foreign key gets an index automatically in InnoDB, so those are not listed;
 * these are the ones a query filters or sorts on that no FK covers.
 */
const EXPECTED = {
    events: [
        ['website_client_id', 'every list is scoped by owner'],
        ['status', 'the tab filter'],
        ['start_date', 'the default sort and the date buckets'],
    ],
    event_guest_groups: [
        ['website_client_id', 'every list is scoped by owner'],
        // Never filtered alone — always beside the owner — so a composite
        // starting with both is what this needs, not an index on is_default.
        [['website_client_id', 'is_default'], 'the Add Guest default-group lookup'],
    ],
    event_guests: [
        ['website_client_id', 'every list is scoped by owner'],
        ['event_id', 'per-event guest list and counts'],
        ['rsvp_status', 'the five status tabs'],
        ['invite_source', 'the Imported tab'],
        ['group_id', 'group member counts'],
        ['responded_at', 'the RSVP trend time series'],
    ],
    event_message_campaigns: [
        ['website_client_id', 'every list is scoped by owner'],
        ['event_id', 'the event filter'],
        ['status', 'the status filter'],
        ['sent_at', 'the date-range filter and default sort'],
    ],
    event_messages: [
        ['website_client_id', 'every list is scoped by owner'],
        ['event_id', 'per-event delivery counts'],
        ['campaign_id', 'a campaign\'s deliveries'],
        ['channel', 'Messages by Channel'],
        ['sent_at', 'the period comparison'],
    ],
};

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
    });
    const db = process.env.DB_NAME;

    console.log(`\n${'='.repeat(78)}`);
    console.log(`${TARGET}   ${db}`);
    console.log('='.repeat(78));

    const missingTables = [];
    let totalColumns = 0;

    for (const table of TABLES) {
        const [exists] = await conn.execute(
            `SELECT TABLE_ROWS FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [db, table]
        );
        if (exists.length === 0) {
            console.log(`\n${table}\n  ** MISSING ON ${TARGET} **`);
            missingTables.push(table);
            continue;
        }

        const [rowCount] = await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
        const [cols] = await conn.execute(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY ORDINAL_POSITION`,
            [db, table]
        );
        totalColumns += cols.length;

        console.log(`\n${'-'.repeat(78)}`);
        console.log(`${table}   ${cols.length} columns · ${rowCount[0].c} rows`);
        console.log('-'.repeat(78));
        for (const c of cols) {
            const nul = c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
            const def = c.COLUMN_DEFAULT === null ? '' : ` = ${c.COLUMN_DEFAULT}`;
            console.log(`  ${c.COLUMN_NAME.padEnd(24)} ${c.COLUMN_TYPE.padEnd(58)} ${nul}${def}`);
        }

        // ── Indexes ────────────────────────────────────────────────────────
        const [idx] = await conn.execute(
            `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
               FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
            [db, table]
        );
        const byIndex = new Map();
        for (const row of idx) {
            if (!byIndex.has(row.INDEX_NAME)) {
                byIndex.set(row.INDEX_NAME, { unique: row.NON_UNIQUE === 0, cols: [] });
            }
            byIndex.get(row.INDEX_NAME).cols.push(row.COLUMN_NAME);
        }

        console.log('\n  INDEXES');
        for (const [name, info] of byIndex) {
            console.log(`    ${info.unique ? 'UNIQUE ' : '       '}${name.padEnd(34)} (${info.cols.join(', ')})`);
        }

        /**
         * An index serves a query only from its LEFT edge: (a, b) helps a
         * filter on `a`, or on `a AND b`, but never on `b` alone.
         *
         * So a single expected column is satisfied by any index whose FIRST
         * column matches, and a composite expectation by any index whose first
         * N columns match in order.
         */
        const indexes = [...byIndex.values()].map((i) => i.cols);
        const covered = (expected) => {
            const want = Array.isArray(expected) ? expected : [expected];
            return indexes.some((cols) => want.every((c, i) => cols[i] === c));
        };
        const gaps = (EXPECTED[table] ?? []).filter(([col]) => !covered(col));
        if (gaps.length) {
            console.log('\n  ** INDEX GAPS **');
            gaps.forEach(([col, why]) => {
                const label = Array.isArray(col) ? `(${col.join(', ')})` : col;
                console.log(`    ${label.padEnd(24)} needed for: ${why}`);
            });
        } else if (EXPECTED[table]) {
            console.log(`\n  index coverage: OK (${EXPECTED[table].length}/${EXPECTED[table].length} expected leading columns present)`);
        }

        // ── Foreign keys ───────────────────────────────────────────────────
        const [fks] = await conn.execute(
            `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
                    k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE
               FROM information_schema.KEY_COLUMN_USAGE k
               JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                 ON r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                AND r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
              WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ?`,
            [db, table]
        );
        if (fks.length) {
            console.log('\n  FOREIGN KEYS');
            for (const fk of fks) {
                console.log(
                    `    ${fk.COLUMN_NAME.padEnd(22)} -> ${(fk.REFERENCED_TABLE_NAME + '.' + fk.REFERENCED_COLUMN_NAME).padEnd(30)} ON DELETE ${fk.DELETE_RULE}`
                );
            }
        }
    }

    // ── website_clients additions ──────────────────────────────────────────
    const [extra] = await conn.execute(
        `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients'
            AND COLUMN_NAME IN ('subscription_plan_id','favourite_templates')`,
        [db]
    );
    console.log(`\n${'-'.repeat(78)}`);
    console.log('website_clients — columns this portal added');
    console.log('-'.repeat(78));
    for (const name of ['subscription_plan_id', 'favourite_templates']) {
        const found = extra.find((c) => c.COLUMN_NAME === name);
        console.log(`  ${name.padEnd(24)} ${found ? found.COLUMN_TYPE : '** MISSING **'}`);
    }

    console.log(`\n${'='.repeat(78)}`);
    console.log(`${TARGET}: ${TABLES.length - missingTables.length}/${TABLES.length} tables · ${totalColumns} columns`);
    if (missingTables.length) {
        console.log(`MISSING TABLES: ${missingTables.join(', ')}`);
    }
    console.log('='.repeat(78) + '\n');

    await conn.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
