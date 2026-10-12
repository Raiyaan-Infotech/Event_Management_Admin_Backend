#!/usr/bin/env node
/**
 * Remove legacy / unused columns from `splash_screens` table:
 * - sound_enabled, sound_url, sound_config
 * - animation_enabled, animation_config
 * - button_text, button_style, button_color
 * - fallback_image_url
 * - show_couple_name, show_event_date, show_tagline
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/remove-old-splash-screen-columns.js --apply
 *   node src/database/tools/remove-old-splash-screen-columns.js --prod --apply
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

const OLD_COLUMNS = [
    'sound_enabled',
    'sound_url',
    'sound_config',
    'animation_enabled',
    'animation_config',
    'button_text',
    'button_style',
    'button_color',
    'fallback_image_url',
    'show_couple_name',
    'show_event_date',
    'show_tagline',
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
        for (const col of OLD_COLUMNS) {
            const [rows] = await conn.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [process.env.DB_NAME, TABLE, col],
            );

            if (rows.length === 0) {
                console.log(`[skip] Column ${TABLE}.${col} does not exist.`);
                continue;
            }

            const sql = `ALTER TABLE \`${TABLE}\` DROP COLUMN \`${col}\`;`;
            console.log(`[plan] ${sql}`);

            if (APPLY) {
                await conn.query(sql);
                console.log(`[done] Dropped ${TABLE}.${col}`);
            }
        }
        console.log('\nMigration complete.');
    } catch (err) {
        console.error('Error dropping old splash_screens columns:', err);
    } finally {
        await conn.end();
    }
})();
