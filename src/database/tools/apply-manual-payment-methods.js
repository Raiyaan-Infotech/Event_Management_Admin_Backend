#!/usr/bin/env node
/**
 * Billing Phase 5 — payment methods without a gateway.
 *
 *   client_payment_methods  token becomes NULLable
 *                           +upi_id +bank_name +account_last4 +ifsc +is_verified
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Phase 3 built this table for a TOKENISED provider: a card is taken by Stripe
 * or Razorpay, and what lands here is their token. `addPaymentMethod` refused
 * to write a row without one, on the reasoning that a saved card that cannot be
 * charged is a promise the next renewal breaks.
 *
 * That reasoning is right for auto-billing and WRONG for this project, which
 * has no gateway and is not getting one: money arrives out of band and a
 * payment is recorded afterwards by hand. Nothing auto-charges, so there is no
 * renewal to fail — and a saved method here is not a chargeable instrument at
 * all. It is a RECORD OF HOW THE CLIENT PAYS, so the vendor knows what to
 * expect and can match it against a bank statement.
 *
 * The tokenised path is untouched and still refuses to invent a token. This
 * adds a second, honest mode beside it.
 *
 * ── ⚠ WHAT THIS STILL REFUSES TO HOLD ───────────────────────────────────────
 * No card number. No CVC. Those were never about the gateway — a full PAN in
 * this database makes the project a party to PCI DSS, and a CVC may not be
 * retained after authorisation by anybody, gateway or not. `assertNoRawCard()`
 * stays in force on the manual path too.
 *
 * And no FULL BANK ACCOUNT NUMBER. Only the last four, plus the bank name and
 * the IFSC — which is a public branch routing code, not a secret. That is
 * enough for a person to recognise their own account on a list and enough to
 * match a statement line; a complete account number is liability with no extra
 * use.
 *
 * ── `is_verified` ───────────────────────────────────────────────────────────
 * A manual method is TYPED BY THE CLIENT. Nobody has checked that the UPI ID
 * resolves or that the account is theirs. The column exists so the screens can
 * say so rather than presenting client-supplied text as though it had been
 * confirmed. Tokenised rows are verified by construction — the provider did it.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-manual-payment-methods.js
 *   node src/database/tools/apply-manual-payment-methods.js --apply
 *   node src/database/tools/apply-manual-payment-methods.js --prod --apply
 *
 * Dry runs by default; `--prod` dry-runs too until `--apply` is added.
 * Requires apply-client-payment-methods.js to have run first.
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

const TABLE = 'client_payment_methods';

const COLUMNS = [
    {
        name: 'upi_id',
        ddl: "ADD COLUMN `upi_id` VARCHAR(120) NULL "
            + "COMMENT 'name@bank. A payment ADDRESS, not a credential — it cannot authorise anything.' "
            + 'AFTER `holder_name`',
    },
    {
        name: 'bank_name',
        ddl: "ADD COLUMN `bank_name` VARCHAR(120) NULL AFTER `upi_id`",
    },
    {
        name: 'account_last4',
        ddl: "ADD COLUMN `account_last4` CHAR(4) NULL "
            + "COMMENT 'LAST FOUR ONLY — there is deliberately no column for a full account number.' "
            + 'AFTER `bank_name`',
    },
    {
        name: 'ifsc',
        ddl: "ADD COLUMN `ifsc` VARCHAR(11) NULL "
            + "COMMENT 'Public RBI branch routing code. Not a secret.' "
            + 'AFTER `account_last4`',
    },
    {
        name: 'is_verified',
        ddl: 'ADD COLUMN `is_verified` TINYINT(1) NOT NULL DEFAULT 0 '
            + "COMMENT 'Manual rows are client-typed and unchecked. A tokenised row is verified by the provider.' "
            + 'AFTER `is_default`',
    },
];

/**
 * The token stops being mandatory.
 *
 * ⚠ The UNIQUE key on (gateway, gateway_payment_method_id) is KEPT and still
 * does its job: MySQL allows many NULLs in a unique index, so every manual row
 * coexists while two rows can still never share one provider token. Duplicate
 * manual entries — the same UPI ID saved twice — are caught in the service,
 * where the rule can say something useful.
 */
const TOKEN_NULLABLE =
    'MODIFY COLUMN `gateway_payment_method_id` VARCHAR(120) NULL '
    + "COMMENT 'The provider token. NULL for a manually recorded method — there is no provider to issue one.'";

async function columns(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_NAME, TABLE],
    );
    return rows;
}

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
        const existing = await columns(conn);
        if (!existing.length) {
            throw new Error(`${TABLE} does not exist — run apply-client-payment-methods.js first.`);
        }

        const have = existing.map((c) => c.COLUMN_NAME);
        const missing = COLUMNS.filter((c) => !have.includes(c.name));
        const parts = missing.map((c) => c.ddl);

        for (const c of COLUMNS) {
            if (have.includes(c.name)) console.log(`  = ${TABLE}.${c.name.padEnd(16)} already present`);
            else if (!APPLY) console.log(`  + ${TABLE}.${c.name.padEnd(16)} WOULD ADD`);
        }

        const token = existing.find((c) => c.COLUMN_NAME === 'gateway_payment_method_id');
        const tokenAlreadyNullable = token && token.IS_NULLABLE === 'YES';
        if (tokenAlreadyNullable) {
            console.log(`  = ${TABLE}.gateway_payment_method_id  already nullable`);
        } else {
            parts.push(TOKEN_NULLABLE);
            if (!APPLY) console.log(`  ~ ${TABLE}.gateway_payment_method_id  WOULD BECOME NULLABLE`);
        }

        if (APPLY && parts.length) {
            // One ALTER, not six: MySQL rebuilds the table per statement, and on
            // Aiven (~374ms a round trip) six passes is six rebuilds.
            await conn.query(`ALTER TABLE \`${TABLE}\` ${parts.join(', ')}`);
            for (const c of missing) console.log(`  + ${TABLE}.${c.name.padEnd(16)} added`);
            if (!tokenAlreadyNullable) console.log(`  ~ ${TABLE}.gateway_payment_method_id  now nullable`);
        }

        // Stated on every run, as the sibling tools do. Anchored on whole words —
        // an unanchored /pan/ once matched `company_id` and cried wolf.
        const names = (await columns(conn)).map((c) => c.COLUMN_NAME);
        const forbidden = names.filter((n) =>
            /^(card_number|card_no|pan|cvv|cvc|card_cvv|security_code|full_card|account_number|account_no)$/i
                .test(n));
        console.log(`\n  ${TABLE}: ${names.length} columns.`);
        console.log(`  card-number / CVC / full-account columns: ${forbidden.length ? forbidden.join(', ') : 'NONE — as intended'}\n`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
