#!/usr/bin/env node
/**
 * Billing Phase 4 — a payment says WHICH card paid it.
 *
 *   client_transactions  +client_payment_method_id  +method_brand  +method_last4
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * `client_transactions` already carried `gateway` and `gateway_transaction_id`,
 * so a payment could name the PROVIDER — but nothing named the CARD. The
 * Invoices table and the invoice's Payment Summary both want "Visa •••• 4242"
 * beside a payment, and there was no column that could answer it. That is why
 * the Payment Method column was absent from the list rather than empty.
 *
 * ── ⚠ THIS STORES NO CARD DATA THAT DID NOT ALREADY EXIST ───────────────────
 * `method_brand` and `method_last4` are a COPY of two display-only fields that
 * `client_payment_methods` already holds. There is still no card number and no
 * CVC anywhere in this database, and this migration does not add a place to put
 * one — the same rule §341 established, and the same one `assertNoRawCard()`
 * enforces in code.
 *
 * ── WHY BOTH AN FK AND A SNAPSHOT ───────────────────────────────────────────
 * The FK is the live link: follow it and you get the card row, its expiry, its
 * status. The two snapshot columns are what an ARCHIVED invoice prints. A card
 * is soft-deleted today, so the FK does resolve — but a receipt that silently
 * changes its wording because a row it points at was edited is not a receipt.
 * The snapshot is written once, at payment time, and never updated.
 *
 * Both are NULL for every existing row, and will stay null until a payment
 * provider exists: there are no payments in this system yet. The columns are
 * here so that wiring one is an INSERT rather than a migration.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-transaction-payment-method.js
 *   node src/database/tools/apply-transaction-payment-method.js --apply
 *   node src/database/tools/apply-transaction-payment-method.js --prod --apply
 *
 * Dry runs by default; `--prod` dry-runs too until `--apply` is added.
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

const TABLE = 'client_transactions';

/**
 * The columns, in the order they are added.
 *
 * `AFTER` keeps them beside `gateway_transaction_id`, which is the other half
 * of the same answer — who took the money, and with what.
 */
const COLUMNS = [
    {
        name: 'client_payment_method_id',
        ddl: "ADD COLUMN `client_payment_method_id` INT UNSIGNED NULL "
            + "COMMENT 'The saved card this payment used. NULL for a payment made another way.' "
            + 'AFTER `gateway_transaction_id`',
    },
    {
        name: 'method_brand',
        ddl: "ADD COLUMN `method_brand` VARCHAR(30) NULL "
            + "COMMENT 'DISPLAY ONLY snapshot, written once at payment time.' "
            + 'AFTER `client_payment_method_id`',
    },
    {
        name: 'method_last4',
        ddl: "ADD COLUMN `method_last4` CHAR(4) NULL "
            + "COMMENT 'DISPLAY ONLY — never the full number.' "
            + 'AFTER `method_brand`',
    },
    {
        // A card is brand + last4; a UPI address is neither. One rendered label
        // covers every method type without the reader having to reassemble it,
        // and it is what an archived invoice prints.
        name: 'method_label',
        ddl: "ADD COLUMN `method_label` VARCHAR(120) NULL "
            + "COMMENT 'Rendered at payment time. Visa ending in 4242 / UPI name@bank.' "
            + 'AFTER `method_last4`',
    },
];

/**
 * The index, not a foreign key.
 *
 * A payment method is SOFT-deleted, so an FK with ON DELETE SET NULL would
 * never fire — and one with RESTRICT would block a hard cleanup of a card that
 * an old, already-settled invoice happens to name. The snapshot columns are
 * what the invoice actually prints, so referential strictness here buys
 * nothing and costs a deletion path.
 */
const INDEX = {
    name: 'client_transactions_method',
    ddl: 'ADD KEY `client_transactions_method` (`client_payment_method_id`)',
};

async function columnNames(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_NAME, TABLE],
    );
    return rows.map((r) => r.COLUMN_NAME);
}

async function indexNames(conn) {
    const [rows] = await conn.query(
        `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_NAME, TABLE],
    );
    return rows.map((r) => r.INDEX_NAME);
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
        const [tables] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [process.env.DB_NAME, TABLE],
        );
        if (!tables.length) {
            throw new Error(`${TABLE} does not exist — run the billing migration first.`);
        }

        const have = await columnNames(conn);
        const missing = COLUMNS.filter((c) => !have.includes(c.name));

        for (const c of COLUMNS) {
            if (have.includes(c.name)) console.log(`  = ${TABLE}.${c.name.padEnd(26)} already present`);
            else if (!APPLY) console.log(`  + ${TABLE}.${c.name.padEnd(26)} WOULD ADD`);
        }

        if (APPLY && missing.length) {
            // One ALTER, not three: MySQL rebuilds the table per statement, and
            // on Aiven (~374ms a round trip) three passes is three rebuilds.
            await conn.query(`ALTER TABLE \`${TABLE}\` ${missing.map((c) => c.ddl).join(', ')}`);
            for (const c of missing) console.log(`  + ${TABLE}.${c.name.padEnd(26)} added`);
        }

        const idx = await indexNames(conn);
        if (idx.includes(INDEX.name)) {
            console.log(`  = ${INDEX.name.padEnd(30)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${INDEX.name.padEnd(30)} WOULD ADD`);
        } else {
            await conn.query(`ALTER TABLE \`${TABLE}\` ${INDEX.ddl}`);
            console.log(`  + ${INDEX.name.padEnd(30)} added`);
        }

        // Stated on every run, for the same reason the payment-methods tool
        // states it: this is the property about these tables that matters most
        // and the easiest to erode later. Anchored on whole words — an
        // unanchored /pan/ once matched `company_id` and cried wolf.
        const names = await columnNames(conn);
        const forbidden = names.filter((n) =>
            /^(card_number|card_no|pan|cvv|cvc|card_cvv|security_code|full_card)$/i.test(n));
        console.log(`\n  ${TABLE}: ${names.length} columns.`);
        console.log(`  card-number / CVC columns: ${forbidden.length ? forbidden.join(', ') : 'NONE — as intended'}\n`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
