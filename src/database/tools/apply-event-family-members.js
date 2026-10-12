/**
 * Event family list (Jamal, 2026-10-12): family is no longer a guest filed under
 * a "Family" group — it is its own per-event list the organizer types in and
 * participants only view.
 *
 *   event_family_members      one row per family member of one event
 *   events.family_settings    json NULL — the organizer's family-list settings
 *                             (profile_screen, profile_photo, name, relationship);
 *                             NULL = the defaults (all on)
 *
 * Idempotent. Nothing is migrated from the old family-tagged guests — they stay
 * where they are, as ordinary guests.
 *
 *   node src/database/tools/apply-event-family-members.js            (dry run, local)
 *   node src/database/tools/apply-event-family-members.js --apply
 *   node src/database/tools/apply-event-family-members.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

const CREATE_TABLE = `CREATE TABLE \`event_family_members\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`event_id\` int unsigned NOT NULL,
  \`website_client_id\` int unsigned NOT NULL COMMENT 'the event owner',
  \`company_id\` int unsigned DEFAULT NULL,
  \`title\` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`name\` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`photo\` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`date_of_birth\` date DEFAULT NULL,
  \`side\` enum('groom','bride') COLLATE utf8mb4_unicode_ci NOT NULL,
  \`relationship\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`relationship_option_id\` int unsigned DEFAULT NULL,
  \`dial_code\` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`mobile\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`email\` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`notes\` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`sort_order\` int NOT NULL DEFAULT '0',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_family_event\` (\`event_id\`,\`sort_order\`),
  KEY \`idx_family_client\` (\`website_client_id\`),
  CONSTRAINT \`fk_event_family_event\` FOREIGN KEY (\`event_id\`) REFERENCES \`events\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const COLUMN = {
    table: 'events',
    column: 'family_settings',
    ddl: `ALTER TABLE \`events\`
  ADD COLUMN \`family_settings\` json DEFAULT NULL COMMENT 'The organizer family-list settings; NULL = the defaults.' AFTER \`participant_settings\``,
};

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
        const [tables] = await conn.query(
            'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
            [dbName, 'event_family_members']
        );
        if (tables.length) {
            console.log('  ✓  event_family_members already exists');
        } else if (!APPLY) {
            console.log('  +  [DRY RUN] Would create event_family_members');
        } else {
            await conn.query(CREATE_TABLE);
            console.log('  ✓  Created event_family_members');
        }

        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [dbName, COLUMN.table, COLUMN.column]
        );
        if (cols.length) {
            console.log(`  ✓  ${COLUMN.table}.${COLUMN.column} already exists`);
        } else if (!APPLY) {
            console.log(`  +  [DRY RUN] Would add ${COLUMN.table}.${COLUMN.column}`);
        } else {
            await conn.query(COLUMN.ddl);
            console.log(`  ✓  Added ${COLUMN.table}.${COLUMN.column}`);
        }
        console.log('\nDone.');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
