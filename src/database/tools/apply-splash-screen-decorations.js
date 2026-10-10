#!/usr/bin/env node
/**
 * `splash_screens` grows `primary_color`, `bg_color`, `decoration_url`, `show_decoration`.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * Supports the mobile app's splash screen design:
 *   - `primary_color`: Hex color for title script font and accents.
 *   - `bg_color`: Hex background color for the splash card.
 *   - `decoration_url`: URL of the chosen admin portal decoration/frame.
 *   - `show_decoration`: Boolean toggle for showing/hiding the decoration.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-splash-screen-decorations.js --apply
 *   node src/database/tools/apply-splash-screen-decorations.js --prod --apply
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
    {
        name: 'primary_color',
        def: "VARCHAR(9) NULL COMMENT 'Hex #RRGGBB or #RRGGBBAA for title script font and accents'",
        after: 'button_color',
    },
    {
        name: 'bg_color',
        def: "VARCHAR(9) NULL COMMENT 'Hex #RRGGBB or #RRGGBBAA for splash background'",
        after: 'primary_color',
    },
    {
        name: 'decoration_url',
        def: "VARCHAR(500) NULL COMMENT 'URL of selected frame or decoration from admin portal'",
        after: 'bg_color',
    },
    {
        name: 'show_decoration',
        def: "TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Toggle to show or hide the decoration overlay'",
        after: 'decoration_url',
    },
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
        const [existingCols] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [process.env.DB_NAME, TABLE],
        );
        const colNames = new Set(existingCols.map((r) => r.COLUMN_NAME));

        for (const col of COLUMNS) {
            if (colNames.has(col.name)) {
                console.log(`  = ${col.name.padEnd(20)} already present`);
            } else if (!APPLY) {
                console.log(`  + ${col.name.padEnd(20)} WOULD ADD (${col.def})`);
            } else {
                await conn.query(
                    `ALTER TABLE \`${TABLE}\`
                       ADD COLUMN \`${col.name}\` ${col.def}
                       AFTER \`${col.after}\``,
                );
                console.log(`  + ${col.name.padEnd(20)} added`);
            }
        }
        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
