#!/usr/bin/env node
/**
 * Personal QR codes (2026-10-28):
 *   1. adds qr_code / qr_token to website_clients (hosts and participants —
 *      one QR per person, the same in every event) and contact_person_logins (src/database/migrations/sql/20261028-person-qr.sql);
 *   2. makes a contact_person_logins row for every event contact number that
 *      has none (one per person: vendor + last 10 digits);
 *   3. fills a QR for every existing row that has none.
 * New rows get theirs from the model hooks (src/models/index.js).
 *
 * Re-runnable: columns only when missing, rows only when empty.
 *
 *   node src/database/tools/apply-person-qr.js                 dry run, local
 *   node src/database/tools/apply-person-qr.js --apply         local
 *   node src/database/tools/apply-person-qr.js --prod          dry run, production
 *   node src/database/tools/apply-person-qr.js --prod --apply  production
 *
 * ⚠ The tokens are encrypted with EVENT_QR_SECRET of the environment the
 * script runs against (.env.production for --prod) — the same key the server
 * there decrypts with. ORDER on production: run this BEFORE pushing the
 * backend (the models read the new columns).
 */

require('dotenv').config();
const fs = require('fs');
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
// Loaded after the env, so the key is the target environment's.
const personQr = require('../../utils/personQr');

const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261028-person-qr.sql');
const TABLES = [
    ['website_clients', 'client'],
    ['contact_person_logins', 'contact_person'],
];

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
    if (!process.env.EVENT_QR_SECRET) {
        throw new Error('EVENT_QR_SECRET is not set for this environment — refusing to issue QR codes.');
    }

    try {
        // 1. Columns.
        const statements = fs.readFileSync(SQL_FILE, 'utf8')
            .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
            .split(';').map((s) => s.trim()).filter(Boolean);
        const hasCols = {};
        for (const [table] of TABLES) {
            const [[c]] = await conn.query(
                `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN ('qr_code', 'qr_token')`,
                [process.env.DB_NAME, table],
            );
            hasCols[table] = c.n === 2;
            if (c.n === 1) throw new Error(`${table} has only one of qr_code / qr_token — fix by hand.`);
            console.log(hasCols[table]
                ? `  = ${table}.qr_code / qr_token   already there`
                : `  + ${table}.qr_code / qr_token   ${APPLY ? 'adding' : 'WOULD ADD'}`);
            if (!hasCols[table] && APPLY) {
                await conn.query(statements.find((s) => s.includes(`\`${table}\``)));
                hasCols[table] = true;
            }
        }

        // 2. A contact person row for every event contact number.
        const [contacts] = await conn.query(
            `SELECT DISTINCT c.vendor_id,
                    RIGHT(REGEXP_REPLACE(e.contact_phone, '[^0-9]', ''), 10) AS mobile
               FROM events e JOIN website_clients c ON c.id = e.website_client_id
              WHERE e.deleted_at IS NULL AND c.vendor_id IS NOT NULL
                AND CHAR_LENGTH(REGEXP_REPLACE(IFNULL(e.contact_phone, ''), '[^0-9]', '')) >= 7`,
        );
        const [existing] = await conn.query('SELECT vendor_id, mobile FROM contact_person_logins');
        const have = new Set(existing.map((r) => `${r.vendor_id}:${r.mobile}`));
        const missing = contacts.filter((r) => !have.has(`${r.vendor_id}:${r.mobile}`));
        console.log(`\n  contact persons: ${contacts.length} event contact number(s), ${missing.length} without a row`
            + (missing.length ? ` → ${APPLY ? 'creating' : 'WOULD CREATE'}` : ''));
        if (APPLY && missing.length) {
            const rows = missing.map((r) => {
                const row = { vendor_id: r.vendor_id, mobile: r.mobile };
                if (hasCols.contact_person_logins) personQr.stamp(row, 'contact_person');
                return row;
            });
            await conn.query(
                'INSERT IGNORE INTO contact_person_logins (vendor_id, mobile, qr_code, qr_token) VALUES ?',
                [rows.map((r) => [r.vendor_id, r.mobile, r.qr_code ?? null, r.qr_token ?? null])],
            );
        }

        // 3. Fill empty QRs — batched (one UPDATE per 300 rows; prod is ~374ms a query).
        for (const [table, kind] of TABLES) {
            if (!hasCols[table]) { console.log(`  ${table}: columns missing (dry run) — skipped`); continue; }
            const [rows] = await conn.query(`SELECT id FROM \`${table}\` WHERE qr_code IS NULL`);
            console.log(`  ${table}: ${rows.length} row(s) without a QR${rows.length ? ` → ${APPLY ? 'filling' : 'WOULD FILL'}` : ''}`);
            if (!APPLY || !rows.length) continue;
            for (let i = 0; i < rows.length; i += 300) {
                const chunk = rows.slice(i, i + 300).map(({ id }) => {
                    const row = {};
                    personQr.stamp(row, kind);
                    return { id, ...row };
                });
                const ids = chunk.map((r) => r.id);
                const codeCase = chunk.map(() => 'WHEN ? THEN ?').join(' ');
                await conn.query(
                    `UPDATE \`${table}\`
                        SET qr_code = CASE id ${codeCase} END,
                            qr_token = CASE id ${codeCase} END
                      WHERE id IN (?) AND qr_code IS NULL`,
                    [
                        ...chunk.flatMap((r) => [r.id, r.qr_code]),
                        ...chunk.flatMap((r) => [r.id, r.qr_token]),
                        ids,
                    ],
                );
            }
            const [[left]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE qr_code IS NULL`);
            console.log(`    ✓ done, ${left.n} left without`);
        }
        console.log('\nDone.\n');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error('\n✗', e.message);
    process.exit(1);
});
