#!/usr/bin/env node
/**
 * Adds `events.disabled_app_menu_ids` (JSON, NULL) — the plan's mobile app
 * features a client switched OFF for one event (session §549). NULL = every app
 * feature the plan grants shows, so no existing event changes.
 *
 * Run BEFORE deploying the new code: the Event model selects the column. Old
 * code never selects it, so adding it first is harmless. Idempotent.
 *
 *   node src/database/tools/apply-event-app-feature-toggles.js                 dry run, local
 *   node src/database/tools/apply-event-app-feature-toggles.js --apply         local
 *   node src/database/tools/apply-event-app-feature-toggles.js --prod --apply  production
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        charset: 'utf8mb4', ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const q = async (sql, p) => (await conn.query(sql, p))[0];
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        const has = (await q(
            `SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'disabled_app_menu_ids'`
        )).length > 0;
        if (has) { console.log('  = events.disabled_app_menu_ids already there — nothing to do'); return; }
        console.log('  - events.disabled_app_menu_ids: WILL ADD (NULL for every existing event = no change)');
        if (!APPLY) { console.log('\nDry run — nothing written.'); return; }
        await q(`ALTER TABLE events ADD COLUMN \`disabled_app_menu_ids\` json DEFAULT NULL
                 COMMENT 'plan app features switched OFF for this event; NULL/[] = all on' AFTER \`menu_ids\``);
        console.log('  + added');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
