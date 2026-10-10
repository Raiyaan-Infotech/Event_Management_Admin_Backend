/**
 * Adds the participant_settings column to events.
 *
 *   events.participant_settings  json NULL
 *     One event's participant settings as the organizer configured it:
 *     profile_screen, profile_photo, name, relationship, attendance_status.
 *     NULL = never configured = the defaults (all true).
 *
 *   node src/database/tools/apply-participant-settings.js            (dry run, local)
 *   node src/database/tools/apply-participant-settings.js --apply
 *   node src/database/tools/apply-participant-settings.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const COLUMNS = [
    {
        table: 'events',
        column: 'participant_settings',
        ddl: `ALTER TABLE \`events\`
  ADD COLUMN \`participant_settings\` json DEFAULT NULL COMMENT 'The organizer participant settings; NULL = the defaults.' AFTER \`rsvp_settings\`;`,
    },
];

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
    const targetLabel = PROD ? 'PRODUCTION' : 'LOCAL';

    console.log(`Target: ${targetLabel} (${env.DB_NAME || env.MYSQL_DATABASE}@${env.DB_HOST || env.MYSQL_HOST})`);
    console.log(`Mode:   ${APPLY ? 'APPLY (mutating)' : 'DRY RUN (no changes)'}\n`);

    const conn = await mysql.createConnection({
        host: env.DB_HOST || env.MYSQL_HOST || 'localhost',
        port: Number(env.DB_PORT || env.MYSQL_PORT || 3306),
        user: env.DB_USER || env.MYSQL_USER,
        password: env.DB_PASSWORD || env.MYSQL_PASSWORD,
        database: env.DB_NAME || env.MYSQL_DATABASE,
    });

    try {
        for (const { table, column, ddl } of COLUMNS) {
            const [rows] = await conn.query(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [env.DB_NAME || env.MYSQL_DATABASE, table, column]
            );

            if (rows.length > 0) {
                console.log(`  ✓  ${table}.${column} already exists`);
                continue;
            }

            if (!APPLY) {
                console.log(`  +  [DRY RUN] Would add ${table}.${column}:`);
                console.log(`     ${ddl.replace(/\n\s*/g, ' ')}`);
                continue;
            }

            console.log(`  +  Adding ${table}.${column}...`);
            await conn.query(ddl);
            console.log(`  ✓  Added ${table}.${column}`);
        }
        console.log('\nDone.');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
