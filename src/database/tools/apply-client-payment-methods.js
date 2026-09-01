#!/usr/bin/env node
/**
 * Billing Phase 3 — saved payment methods.
 *
 *   client_payment_methods
 *
 * ── ⚠ WHAT THIS TABLE DELIBERATELY CANNOT HOLD ─────────────────────────────
 * There is NO column for a card number, and NO column for a CVC. There never
 * will be. What is stored is what the gateway hands back after IT has taken the
 * card: an opaque token, plus the brand, the last four digits and the expiry —
 * which are the only parts a person needs in order to recognise their own card
 * in a list.
 *
 * This is not caution for its own sake, it is the only lawful shape:
 *
 *  · A full card number ("PAN") in your database makes YOU a party to PCI DSS —
 *    annual assessment, network segmentation, key rotation, breach liability.
 *  · A CVC may NOT be stored after authorisation by ANY party, compliant or
 *    not. There is no configuration that makes it allowed.
 *
 * The supplied design agrees, incidentally: its own sidebar says "PCI DSS
 * compliant · Powered by Stripe". The card in that mockup is held by Stripe.
 *
 * ── HOW A CARD ACTUALLY GETS HERE ───────────────────────────────────────────
 * The card fields on the Add form belong to the GATEWAY's own hosted element
 * (Stripe Elements, Razorpay Checkout). The digits go from the browser straight
 * to the provider and never touch this backend; the browser gets a token back
 * and posts THAT to `POST /client/billing/payment-methods`. The service refuses
 * anything that looks like a raw card number, so a well-meaning future change
 * to the form cannot quietly start sending them.
 *
 * ⚠ NO PROVIDER IS CONNECTED YET. `gateway` is stored per row so the day one is
 * chosen, existing rows still say which provider holds them — a single-provider
 * assumption is exactly what makes a migration painful later.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-client-payment-methods.js
 *   node src/database/tools/apply-client-payment-methods.js --apply
 *   node src/database/tools/apply-client-payment-methods.js --prod --apply
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

/** Read, never guessed — see §313.3 and the six migrations that guess cost. */
async function clientIdType(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'website_clients' AND COLUMN_NAME = 'id'`,
        [process.env.DB_NAME],
    );
    if (!rows.length) throw new Error('website_clients.id not found — wrong database?');
    return rows[0].COLUMN_TYPE.toUpperCase();
}

const table = (fk) => `
CREATE TABLE IF NOT EXISTS \`client_payment_methods\` (
  \`id\`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`website_client_id\` ${fk} NOT NULL,
  \`company_id\`        INT NULL,

  -- WHO holds the card. Stored per row: the day a second provider is added, or
  -- the first one is replaced, existing rows still say who to ask.
  \`gateway\`           VARCHAR(30)  NOT NULL,

  -- The provider's own identifiers. \`gateway_payment_method_id\` is the token
  -- that stands in for the card; it is useless to anybody without the
  -- provider's secret key, which is why it is safe to keep here.
  \`gateway_customer_id\`       VARCHAR(120) NULL,
  \`gateway_payment_method_id\` VARCHAR(120) NOT NULL,

  -- ⚠ DISPLAY ONLY. Four digits and an expiry cannot be used to charge a card,
  -- and are the minimum needed for somebody to recognise which card is which.
  -- There is no column for the other twelve digits and none for the CVC.
  \`brand\`             VARCHAR(30)  NULL COMMENT 'visa / mastercard / amex / rupay …',
  \`last4\`             CHAR(4)      NULL COMMENT 'DISPLAY ONLY — never the full number',
  \`exp_month\`         TINYINT UNSIGNED NULL,
  \`exp_year\`          SMALLINT UNSIGNED NULL,
  \`holder_name\`       VARCHAR(120) NULL,

  -- 'card' today; kept open because UPI and net-banking mandates are the two
  -- an Indian gateway offers next, and they are not cards.
  \`method_type\`       VARCHAR(20)  NOT NULL DEFAULT 'card',

  \`is_default\`        TINYINT(1)   NOT NULL DEFAULT 0,
  \`status\`            ENUM('active','expired','removed') NOT NULL DEFAULT 'active',

  \`created_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Soft delete: a removed card is still named by the invoices it paid, so the
  -- row has to survive being "deleted" from the client's list.
  \`deleted_at\`        DATETIME     NULL,

  PRIMARY KEY (\`id\`),
  -- The same card cannot be saved twice. The token is the provider's identity
  -- for it, so this is the real duplicate check — not brand+last4, which two
  -- genuinely different cards can share.
  UNIQUE KEY \`client_payment_methods_token\` (\`gateway\`, \`gateway_payment_method_id\`),
  KEY \`client_payment_methods_client\` (\`website_client_id\`, \`deleted_at\`, \`is_default\`),
  CONSTRAINT \`fk_client_payment_methods_client\`
    FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

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
        const fk = await clientIdType(conn);
        console.log(`  website_clients.id is ${fk} — foreign key will match it\n`);

        const [existing] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'client_payment_methods'`,
            [process.env.DB_NAME],
        );

        if (existing.length) {
            console.log('  = client_payment_methods      already present, skipping');
        } else if (!APPLY) {
            console.log('  + client_payment_methods      WOULD CREATE');
        } else {
            await conn.query(table(fk));
            console.log('  + client_payment_methods      created');
        }

        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'client_payment_methods'`,
            [process.env.DB_NAME],
        );
        if (cols.length) {
            const names = cols.map((c) => c.COLUMN_NAME);
            // Stated out loud on every run, because it is the property that
            // matters most about this table and the easiest to erode later.
            // Anchored on whole words. An unanchored /pan/ matched `company_id`
            // and reported the table as unsafe on its very first run — a check
            // that cries wolf is a check people learn to ignore.
            const forbidden = names.filter((n) =>
                /^(card_number|card_no|pan|cvv|cvc|card_cvv|security_code|full_card)$/i.test(n));
            console.log(`\n  ${names.length} columns.`);
            console.log(`  card-number / CVC columns: ${forbidden.length ? forbidden.join(', ') : 'NONE — as intended'}\n`);
        }
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
