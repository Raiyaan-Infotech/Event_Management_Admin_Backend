/**
 * Drops `event_participants.group_id` (Jamal, 2026-10-12).
 *
 * A participant is placed by Groom / Bride side (`rsvp_side`) and `relationship`
 * — not by a guest group. Only the phone-book `guests.group_id` keeps a group.
 *
 * ⚠ DESTRUCTIVE: the column's data is gone for good. The dry run prints how many
 * rows hold a group. Take a backup first on production.
 *
 *   node src/database/tools/apply-drop-participant-group.js            (dry run, local)
 *   node src/database/tools/apply-drop-participant-group.js --apply
 *   node src/database/tools/apply-drop-participant-group.js --prod --apply
 *
 * Idempotent: a second run reports the column already gone.
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const l of raw.split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

(async () => {
    const env = PROD ? parseEnv('.env.production') : localEnv;
    const dbName = env.DB_NAME || env.MYSQL_DATABASE;
    console.log(`Target: ${PROD ? 'PRODUCTION' : 'LOCAL'} (${dbName}@${env.DB_HOST || env.MYSQL_HOST})`);
    console.log(`Mode:   ${APPLY ? 'APPLY (mutating)' : 'DRY RUN (no changes)'}\n`);

    const conn = await mysql.createConnection({
        host: env.DB_HOST || env.MYSQL_HOST || 'localhost',
        port: Number(env.DB_PORT || env.MYSQL_PORT || 3306),
        user: env.DB_USER || env.MYSQL_USER,
        password: env.DB_PASSWORD || env.MYSQL_PASSWORD,
        database: dbName,
    });

    try {
        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_participants' AND COLUMN_NAME = 'group_id'`,
            [dbName],
        );
        if (!cols.length) {
            console.log('  ✓  event_participants.group_id is already gone');
            return;
        }

        const [[counts]] = await conn.query(
            'SELECT COUNT(*) AS total, SUM(group_id IS NOT NULL) AS with_group FROM event_participants',
        );
        console.log(`  ·  ${counts.with_group || 0} of ${counts.total} participant rows hold a group — that link is lost.`);

        const [fks] = await conn.query(
            `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'event_participants'
                AND COLUMN_NAME = 'group_id' AND REFERENCED_TABLE_NAME IS NOT NULL`,
            [dbName],
        );

        if (!APPLY) {
            for (const fk of fks) console.log(`  -  [DRY RUN] Would drop foreign key ${fk.CONSTRAINT_NAME}`);
            console.log('  -  [DRY RUN] Would drop column event_participants.group_id');
            return;
        }

        // The foreign key first — MySQL will not drop a column a constraint uses.
        for (const fk of fks) {
            await conn.query(`ALTER TABLE \`event_participants\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
            console.log(`  ✓  Dropped foreign key ${fk.CONSTRAINT_NAME}`);
        }
        // Any index left on the column goes with it.
        await conn.query('ALTER TABLE `event_participants` DROP COLUMN `group_id`');
        console.log('  ✓  Dropped event_participants.group_id');
    } finally {
        await conn.end();
        console.log('\nDone.');
    }
})().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
