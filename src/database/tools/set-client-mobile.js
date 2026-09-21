#!/usr/bin/env node
/**
 * Sets the mobile number on ONE website client.
 *
 * ── WHY A TOOL FOR ONE COLUMN ───────────────────────────────────────────────
 * The app signs in by mobile OTP, so a client row without a number cannot be
 * used to test the app at all — which is the state #28 Arsath and #29 Najeeb
 * were created in (§514). Adding it in the admin Clients screen works too;
 * this exists so the change is repeatable, dry-run first, and recorded the
 * same way every other production write in this folder is.
 *
 * `website_clients.mobile` is UNIQUE (apply-website-client-unique-mobile.js),
 * and the login endpoint matches on the last 10 digits regardless of how the
 * number was typed (`+91 98846 99435`, `919884699435`, `9884699435`), so a
 * second row carrying the same 10 digits makes BOTH accounts unreachable. The
 * check below refuses that before writing rather than leaving it to the index.
 *
 *   node src/database/tools/set-client-mobile.js --id 28 --mobile 9000000028
 *   node src/database/tools/set-client-mobile.js --id 28 --mobile 9000000028 --apply
 *   node src/database/tools/set-client-mobile.js --id 28 --mobile 9000000028 --prod --apply
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
const argValue = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
};

const ID = Number(argValue('--id'));
const RAW_MOBILE = argValue('--mobile');
const DIAL_CODE = argValue('--dial-code') || '+91';

if (!ID || !RAW_MOBILE || RAW_MOBILE.startsWith('--')) {
    console.error('Usage: --id <client-id> --mobile <10 digits> [--dial-code +91] [--apply] [--prod]');
    process.exit(1);
}

// Stored bare, the way websiteClient.service writes it and the OTP login reads
// it — the country code lives in its own column.
const MOBILE = String(RAW_MOBILE).replace(/\D/g, '');
if (MOBILE.length !== 10) {
    console.error(`--mobile must be 10 digits after stripping punctuation (got "${RAW_MOBILE}" -> "${MOBILE}").`);
    process.exit(1);
}

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
        const [client] = await q(
            'SELECT id, name, email, dial_code, mobile, subscription_plan_id FROM website_clients WHERE id = ?',
            [ID],
        );
        if (!client) throw new Error(`No website_client #${ID}.`);

        // Single-quoted string literals inside the SQL, deliberately: production
        // runs with ANSI_QUOTES, where "..." is an IDENTIFIER and this reads as
        // `Unknown column ''`.
        const clash = await q(
            "SELECT id, name FROM website_clients WHERE id <> ? "
            + "AND RIGHT(REGEXP_REPLACE(COALESCE(mobile, ''), '[^0-9]', ''), 10) = ?",
            [ID, MOBILE],
        );
        if (clash.length) {
            throw new Error(
                `${MOBILE} already belongs to ${clash.map((c) => `#${c.id} ${c.name}`).join(', ')} — `
                + 'the OTP login would not be able to tell the accounts apart.',
            );
        }

        console.log(`#${client.id} ${client.name} <${client.email || 'no email'}>  plan=${client.subscription_plan_id ?? 'none'}`);
        console.log(`  mobile: ${client.dial_code || '—'} ${client.mobile || '(none)'}  ->  ${DIAL_CODE} ${MOBILE}`);

        if (String(client.mobile || '').replace(/\D/g, '') === MOBILE && client.dial_code === DIAL_CODE) {
            console.log('\nAlready set — nothing to do.');
            return;
        }
        if (!APPLY) {
            console.log('\nDry run only. Re-run with --apply to write.');
            return;
        }

        await q('UPDATE website_clients SET dial_code = ?, mobile = ?, updated_at = NOW() WHERE id = ?',
            [DIAL_CODE, MOBILE, ID]);
        const [after] = await q('SELECT dial_code, mobile FROM website_clients WHERE id = ?', [ID]);
        console.log(`\nWritten. Now: ${after.dial_code} ${after.mobile}`);
    } catch (err) {
        console.error(`\n${err.message}`);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
