#!/usr/bin/env node
/**
 * "My Briefcase" → "My Favourites" (Jamal, 2026-10-28): saved contacts from a
 * participant QR scan (and later, documents) live there. Only the visible
 * name, description and icon change — the slug stays `my-briefcase`, because
 * plan grants and every account's saved Quick Actions refer to it.
 *
 *   node src/database/tools/apply-rename-favourites.js                 dry run, local
 *   node src/database/tools/apply-rename-favourites.js --apply         local
 *   node src/database/tools/apply-rename-favourites.js --prod          dry run, production
 *   node src/database/tools/apply-rename-favourites.js --prod --apply  production
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

const TO = {
    name: 'My Favourites',
    description: 'Contacts you saved by scanning a QR, and your scan history.',
    icon: 'mdi:heart-outline',
};

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);
    try {
        const [rows] = await conn.query(
            "SELECT id, name, icon FROM event_menus WHERE slug = 'my-briefcase' AND deleted_at IS NULL",
        );
        if (!rows.length) console.log('  (no my-briefcase menu)');
        for (const r of rows) {
            const same = r.name === TO.name && r.icon === TO.icon;
            console.log(`  #${r.id}  "${r.name}" (${r.icon})  →  ${same ? 'already renamed' : `"${TO.name}" (${TO.icon})`}`);
        }
        if (APPLY && rows.length) {
            const [res] = await conn.query(
                "UPDATE event_menus SET name = ?, description = ?, icon = ? WHERE slug = 'my-briefcase' AND deleted_at IS NULL",
                [TO.name, TO.description, TO.icon],
            );
            console.log(`  ✓ ${res.affectedRows} menu row(s) updated`);
        }
        console.log('\nDone.\n');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('\n✗', e.message);
    process.exit(1);
});
