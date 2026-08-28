#!/usr/bin/env node
/**
 * Adds the two profile columns the client-portal Settings page needs.
 *
 *   website_clients.company_name   VARCHAR(150) NULL
 *   website_clients.bio            TEXT         NULL
 *
 * Both are optional free text a client types about themselves. They are the
 * only FORM fields on the supplied Settings design with no column behind them —
 * everything else on that screen either already exists or belongs to a feature
 * that has no schema at all (notifications, sessions, billing).
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-website-client-profile-columns.js
 *   node src/database/tools/apply-website-client-profile-columns.js --apply
 *   node src/database/tools/apply-website-client-profile-columns.js --prod
 *   node src/database/tools/apply-website-client-profile-columns.js --prod --apply
 *
 * Dry runs by default, and `--prod` dry-runs too until `--apply` is added —
 * there is no combination of flags that writes to production by accident.
 *
 * ── ONE ALTER PER COLUMN, DELIBERATELY ──────────────────────────────────────
 * A combined multi-column ALTER fails outright if even ONE column already
 * exists, which leaves a half-applied schema fixable only by hand-editing SQL.
 * Separately, each is skipped if present, so re-running is a no-op.
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

const COLUMNS = [
    {
        name: 'company_name',
        sql: 'ADD COLUMN `company_name` VARCHAR(150) NULL AFTER `name`',
    },
    {
        name: 'bio',
        sql: 'ADD COLUMN `bio` TEXT NULL AFTER `company_name`',
    },
];

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        // utf8mb4 or a bio with an emoji in it is diagnosed as corrupt when it
        // is the READ that mangled it.
        charset: 'utf8mb4',
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    const target = `${process.env.DB_NAME} @ ${process.env.DB_HOST}`;
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${target}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        const [existing] = await conn.query('SHOW COLUMNS FROM `website_clients`');
        const have = new Set(existing.map((c) => c.Field));

        for (const col of COLUMNS) {
            if (have.has(col.name)) {
                console.log(`  = ${col.name.padEnd(14)} already present, skipping`);
                continue;
            }
            if (!APPLY) {
                console.log(`  + ${col.name.padEnd(14)} WOULD ADD`);
                continue;
            }
            await conn.query(`ALTER TABLE \`website_clients\` ${col.sql}`);
            console.log(`  + ${col.name.padEnd(14)} added`);
        }

        const [after] = await conn.query('SHOW COLUMNS FROM `website_clients`');
        const names = after.map((c) => c.Field);
        console.log(
            `\n  website_clients now has ${names.length} columns; ` +
            `company_name=${names.includes('company_name')} bio=${names.includes('bio')}\n`
        );
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
