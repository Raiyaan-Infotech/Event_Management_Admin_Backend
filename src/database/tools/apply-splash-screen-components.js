#!/usr/bin/env node
/**
 * `splash_screens` grows `theme_id`, `secondary_color`, `components`, and `component_order`.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * Reusing the invitation card design and component hierarchy in the splash screen
 * module, allowing the splash screen to render identically to the invitation card
 * while maintaining its own component toggles (where organizer details is default OFF).
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-splash-screen-components.js --prod --apply
 *   node src/database/tools/apply-splash-screen-components.js --apply
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

const TABLE = 'splash_screens';

const COLUMNS = [
    { name: 'theme_id', def: 'VARCHAR(50) NULL COMMENT \'Template code/id for invitation style matching\' AFTER event_id' },
    { name: 'secondary_color', def: 'VARCHAR(9) NULL COMMENT \'Secondary accent color for splash elements\' AFTER primary_color' },
    { name: 'components', def: 'JSON NULL COMMENT \'Component visibility toggles (organizer default off)\' AFTER show_decoration' },
    { name: 'component_order', def: 'JSON NULL COMMENT \'Display order of components\' AFTER components' },
];

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
        for (const col of COLUMNS) {
            const [rows] = await conn.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [process.env.DB_NAME, TABLE, col.name],
            );

            if (rows.length > 0) {
                console.log(`[skip] Column ${TABLE}.${col.name} already exists.`);
                continue;
            }

            const sql = `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${col.name}\` ${col.def};`;
            console.log(`[plan] ${sql}`);

            if (APPLY) {
                await conn.query(sql);
                console.log(`[done] Added ${TABLE}.${col.name}`);
            }
        }
        console.log('\nMigration complete.');
    } catch (err) {
        console.error('Error migrating splash_screens:', err);
    } finally {
        await conn.end();
    }
})();
