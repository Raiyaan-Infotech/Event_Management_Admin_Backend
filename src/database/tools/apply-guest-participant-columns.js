#!/usr/bin/env node
/**
 * `event_guests` grows the four things self-registration needs.
 *
 *   gender                      the one form field with no column
 *   participant_client_id       the guest's OWN app account
 *   relationship_option_id      FK to the chosen dropdown row
 *   food_preference_option_id   FK to the chosen dropdown row
 *   invite_source               + 'qr'
 *
 * ── WHY NOT A SEPARATE `event_members` TABLE ────────────────────────────────
 * An earlier sketch had one. It was dropped once the mobile app's own model was
 * read: `participant_data.dart` says "the Participants module (also reused by
 * the Guests module)" — participants and guests are ONE concept the two screens
 * name differently, and `event_guests` already carries every field the
 * registration form collects except gender.
 *
 * A second table would have meant two rows per person, a join to answer "who is
 * coming", and a standing question of which one the RSVP donut counts.
 *
 * ── ⚠ `participant_client_id` IS NOT `website_client_id` ────────────────────
 * They are both website_clients ids and they mean opposite things:
 *
 *   website_client_id       the HOST — denormalised from the event so guest
 *                           queries scope by owner without a join
 *   added_by_client_id      who INVITED them ("Invited By")
 *   participant_client_id   the guest's own account, once they register
 *
 * Reusing the first would have made every guest look like their own host and
 * silently widened what `/client/guests` returns. It is nullable forever: most
 * guests are typed in by a host and never install anything.
 *
 * ── THE OPTION FKs SIT ALONGSIDE THE LABELS, NOT INSTEAD OF THEM ────────────
 * `relationship` and `dietary_preference` keep storing the chosen TEXT. What a
 * guest answered is a historical fact; if an admin later renames "Vegetarian"
 * or deletes it, Mohammed Ali must still have said "Vegetarian". The FK is for
 * grouping and reporting, and is ON DELETE SET NULL so removing an option can
 * never remove a guest.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-guest-participant-columns.js
 *   node src/database/tools/apply-guest-participant-columns.js --apply
 *   node src/database/tools/apply-guest-participant-columns.js --prod --apply
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

const TABLE = 'event_guests';

/** Read a referenced column's type rather than assuming it. */
async function columnType(conn, table, column) {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.DB_NAME, table, column],
    );
    if (!rows.length) throw new Error(`${table}.${column} not found — wrong database?`);
    return rows[0].COLUMN_TYPE.toUpperCase();
}

async function hasColumn(conn, column) {
    const [rows] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.DB_NAME, TABLE, column],
    );
    return rows.length > 0;
}

async function hasForeignKey(conn, name) {
    const [rows] = await conn.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
            AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [process.env.DB_NAME, TABLE, name],
    );
    return rows.length > 0;
}

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
        // The option tables must exist before anything can key into them.
        for (const t of ['guest_relationship_options', 'guest_food_preference_options']) {
            if (!(await tableExists(conn, t))) {
                throw new Error(
                    `${t} is missing — run apply-guest-option-tables.js first.`,
                );
            }
        }

        const clientFk = await columnType(conn, 'website_clients', 'id');
        const optionFk = await columnType(conn, 'guest_relationship_options', 'id');
        console.log(`  website_clients.id is ${clientFk}`);
        console.log(`  option ids are ${optionFk} — foreign keys will match\n`);

        const columns = [
            {
                name: 'gender',
                ddl: "ADD COLUMN `gender` ENUM('male','female','other') NULL AFTER `last_name`",
                note: 'the form asks; nothing stored it',
            },
            {
                name: 'participant_client_id',
                ddl: `ADD COLUMN \`participant_client_id\` ${clientFk} NULL AFTER \`added_by_client_id\``,
                note: "the guest's own account — NOT the host",
            },
            {
                name: 'relationship_option_id',
                ddl: `ADD COLUMN \`relationship_option_id\` ${optionFk} NULL AFTER \`relationship\``,
                note: 'alongside the label, not instead of it',
            },
            {
                name: 'food_preference_option_id',
                ddl: `ADD COLUMN \`food_preference_option_id\` ${optionFk} NULL AFTER \`dietary_preference\``,
                note: 'alongside the label, not instead of it',
            },
        ];

        for (const col of columns) {
            if (await hasColumn(conn, col.name)) {
                console.log(`  = ${col.name.padEnd(26)} already present`);
            } else if (!APPLY) {
                console.log(`  + ${col.name.padEnd(26)} WOULD ADD    (${col.note})`);
            } else {
                await conn.query(`ALTER TABLE \`${TABLE}\` ${col.ddl}`);
                console.log(`  + ${col.name.padEnd(26)} added        (${col.note})`);
            }
        }

        console.log('');

        // 'qr' — how a self-registered participant arrived. Every existing value
        // is preserved; MODIFY only widens the set.
        const inviteSource = await columnType(conn, TABLE, 'invite_source');
        if (inviteSource.includes("'QR'") || inviteSource.includes("'qr'")) {
            console.log("  = invite_source            already accepts 'qr'");
        } else if (!APPLY) {
            console.log("  + invite_source            WOULD ADD 'qr'");
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\` MODIFY COLUMN \`invite_source\`
                   ENUM('whatsapp','email','sms','manual','import','qr')
                   NOT NULL DEFAULT 'manual'`,
            );
            console.log("  + invite_source            'qr' added");
        }

        console.log('');

        const keys = [
            {
                name: 'fk_event_guests_participant_client',
                column: 'participant_client_id',
                ref: 'website_clients',
                // The account going away must not delete somebody's guest row —
                // they were still invited, and still ate.
                onDelete: 'SET NULL',
            },
            {
                name: 'fk_event_guests_relationship_option',
                column: 'relationship_option_id',
                ref: 'guest_relationship_options',
                onDelete: 'SET NULL',
            },
            {
                name: 'fk_event_guests_food_option',
                column: 'food_preference_option_id',
                ref: 'guest_food_preference_options',
                onDelete: 'SET NULL',
            },
        ];

        for (const key of keys) {
            if (await hasForeignKey(conn, key.name)) {
                console.log(`  = ${key.name.padEnd(38)} already present`);
            } else if (!APPLY) {
                console.log(`  + ${key.name.padEnd(38)} WOULD ADD`);
            } else {
                await conn.query(
                    `ALTER TABLE \`${TABLE}\`
                       ADD CONSTRAINT \`${key.name}\` FOREIGN KEY (\`${key.column}\`)
                       REFERENCES \`${key.ref}\` (\`id\`)
                       ON DELETE ${key.onDelete} ON UPDATE CASCADE`,
                );
                console.log(`  + ${key.name.padEnd(38)} added`);
            }
        }

        // "Which events am I a participant of" — the app's My Events for a guest.
        const indexName = 'idx_event_guests_participant';
        const [idx] = await conn.query(
            `SELECT INDEX_NAME FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
            [process.env.DB_NAME, TABLE, indexName],
        );
        console.log('');
        if (idx.length) {
            console.log(`  = ${indexName.padEnd(38)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${indexName.padEnd(38)} WOULD ADD`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD INDEX \`${indexName}\` (\`participant_client_id\`, \`deleted_at\`)`,
            );
            console.log(`  + ${indexName.padEnd(38)} added`);
        }
        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
