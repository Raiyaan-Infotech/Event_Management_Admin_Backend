/*
 * Saved payment methods — the HTTP layer, plus the one guard that matters most.
 *
 * ── THE GUARD ───────────────────────────────────────────────────────────────
 * A card number must never reach this server. The gateway takes the card in the
 * browser and returns a token; only the token is posted here. Most of this file
 * is proving that a body carrying card-shaped data is REFUSED rather than
 * stored — because that rule has to survive somebody editing the form later,
 * and a comment does not survive anything.
 *
 * ── TWO MODES ───────────────────────────────────────────────────────────────
 * TOKENISED — a body carrying a provider token. Still 503 while no provider is
 *   configured: a token that came from nowhere could never charge anything.
 * MANUAL — no token, and a UPI ID or bank account instead. This is the mode this
 *   project actually uses, since money arrives out of band and a payment is
 *   recorded by hand afterwards. It works with no provider, by design.
 *
 * The manual mode is NOT a way around the card rule, and this file proves it:
 * a manual body carrying card-shaped data is refused exactly as a tokenised one
 * is, and a full bank account number is refused rather than trimmed.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-payment-methods.test.js
 * Requires the backend running on :5001 and the seeded test client.
 */
require('dotenv').config();

const { sequelize, ClientPaymentMethod } = require('../src/models');
const svc = require('../src/services/clientPaymentMethod.service');

const BASE = process.env.TEST_API_URL || 'http://localhost:5001/api/v1';
const CREDENTIALS = { email: 'test@example.com', password: 'Test@123' };

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

let cookies = '';
const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(cookies ? { Cookie: cookies } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body: json };
};

/** What a gateway callback will do. Never a card number — a token. */
const seedCard = (clientId, over = {}) => ClientPaymentMethod.create({
    website_client_id: clientId,
    company_id: 1,
    gateway: 'razorpay',
    gateway_payment_method_id: `tok_test_${Math.random().toString(36).slice(2, 12)}`,
    brand: 'visa',
    last4: '4242',
    exp_month: 6,
    exp_year: new Date().getFullYear() + 2,
    holder_name: 'Test Client',
    ...over,
});

(async () => {
    console.log(`\nPayment methods against ${BASE}\n`);
    let clientId = null;

    try {
        // ── The guard, in-process — every shape it must refuse ─────────────
        console.log('── raw card data is refused ──────────────────────────');
        for (const [body, label] of [
            [{ card_number: '4111111111111111' }, 'a card_number key'],
            [{ cardNumber: '4111 1111 1111 1111' }, 'a camelCase cardNumber key'],
            [{ cvv: '123' }, 'a cvv key'],
            [{ cvc: '123' }, 'a cvc key'],
            [{ expiry: '06/27' }, 'an expiry key'],
            [{ holder_name: '4111111111111111' }, 'a PAN hidden in another field'],
            [{ holder_name: '4111 1111 1111 1111' }, 'a spaced PAN in another field'],
        ]) {
            let threw = false;
            try { svc.assertNoRawCard(body); } catch { threw = true; }
            ok(`refuses ${label}`, threw);
        }

        // ...and does NOT cry wolf on ordinary data.
        for (const [body, label] of [
            [{ holder_name: 'Rohan Mehta' }, 'a name'],
            [{ gateway_payment_method_id: 'pm_1PYXnLm23abc456def' }, 'a gateway token'],
            [{ reference: '1234567890123456' }, 'a 16-digit reference that fails Luhn'],
            [{ last4: '4242' }, 'the last four digits'],
        ]) {
            let threw = false;
            try { svc.assertNoRawCard(body); } catch { threw = true; }
            ok(`allows ${label}`, !threw);
        }

        // ── Expiry is end-of-month, not start ──────────────────────────────
        console.log('\n── expiry ────────────────────────────────────────');
        ok('a card marked 06/2027 is still valid on 30 Jun 2027',
            svc.isExpired({ exp_month: 6, exp_year: 2027 }, new Date('2027-06-30T23:00:00Z')) === false);
        ok('and expired on 1 Jul 2027',
            svc.isExpired({ exp_month: 6, exp_year: 2027 }, new Date('2027-07-01T00:00:00Z')) === true);
        ok('no expiry stored is never treated as expired',
            svc.isExpired({ exp_month: null, exp_year: null }) === false);

        // ── HTTP ───────────────────────────────────────────────────────────
        console.log('\n── unauthenticated ───────────────────────────────');
        {
            const res = await call('GET', '/client/billing/payment-methods');
            ok('GET without a session -> 401', res.status === 401, `got ${res.status}`);
        }

        const login = await call('POST', '/public/website-clients/login', CREDENTIALS);
        ok('signs in', login.status === 200, `got ${login.status}`);
        clientId = login.body?.data?.client?.id;

        /*
          Start from nothing.

          The cleanup at the end only runs if the suite reaches it — an
          interrupted run leaves rows behind, and the next run then failed on
          "the same UPI ID twice" for a reason that had nothing to do with the
          code. A suite that fails depending on how the last one ended is a
          suite people stop believing.

          `force` because the table is paranoid: a soft-deleted row still holds
          its UPI ID against the duplicate check.
        */
        await sequelize.query('DELETE FROM client_payment_methods WHERE website_client_id = ?',
            { replacements: [clientId] });

        console.log('\n── with no provider connected ────────────────────');
        {
            const list = await call('GET', '/client/billing/payment-methods');
            ok('list works even with no provider', list.status === 200, `got ${list.status}`);
            ok('and reports the gateway as not connected, with a reason',
                list.body?.data?.gateway?.enabled === false
                && typeof list.body?.data?.gateway?.reason === 'string',
                JSON.stringify(list.body?.data?.gateway));
            /*
              can_add is TRUE with no provider now. The cap is the only thing
              that stops adding — the manual route needs no gateway.
            */
            ok('can_add is true even with no provider, because manual needs none',
                list.body?.data?.can_add === true, JSON.stringify(list.body?.data?.can_add));
            ok('the manual mode is offered, with the server\'s own explanation',
                list.body?.data?.manual?.enabled === true
                && typeof list.body?.data?.manual?.reason === 'string',
                JSON.stringify(list.body?.data?.manual));
            ok('and it offers UPI and bank transfer, not card',
                JSON.stringify((list.body?.data?.manual?.types ?? []).map((t) => t.value))
                    === JSON.stringify(['upi', 'bank_transfer']),
                JSON.stringify(list.body?.data?.manual?.types));
            ok('the max is stated by the server, not the UI',
                list.body?.data?.max_methods === svc.MAX_METHODS);

            const add = await call('POST', '/client/billing/payment-methods', {
                gateway_payment_method_id: 'pm_test_123', brand: 'visa', last4: '4242',
            });
            ok('adding -> 503, not 400 (our gap, not their mistake)',
                add.status === 503, `got ${add.status}`);

            const raw = await call('POST', '/client/billing/payment-methods', {
                card_number: '4111111111111111', cvv: '123',
            });
            ok('a raw card over HTTP -> 400 and is never stored',
                raw.status === 400, `got ${raw.status}`);
            const [{ n }] = await sequelize.query(
                'SELECT COUNT(*) n FROM client_payment_methods WHERE website_client_id = ?',
                { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
            );
            ok('still no rows after the refusals', Number(n) === 0, `${n} rows`);
        }

        // ── Manual methods: the mode this project actually uses ────────────
        console.log('\n── manual methods (no gateway) ───────────────────');
        {
            const bad = await call('POST', '/client/billing/payment-methods', {
                method_type: 'card', brand: 'visa', last4: '4242',
            });
            ok('a manual CARD is refused — four unverifiable digits are not a method',
                bad.status === 400, `got ${bad.status}`);

            const badUpi = await call('POST', '/client/billing/payment-methods', {
                method_type: 'upi', upi_id: 'not-a-upi-id',
            });
            ok('a malformed UPI ID -> 400 with a shape, not just "invalid"',
                badUpi.status === 400 && /name@bank/.test(badUpi.body?.message || ''),
                badUpi.body?.message);

            /*
              The one that matters most on this path: a FULL account number is
              refused, not silently trimmed to four. Trimming would mean the
              whole number had already reached this server.
            */
            const fullAccount = await call('POST', '/client/billing/payment-methods', {
                method_type: 'bank_transfer', bank_name: 'HDFC Bank',
                account_last4: '50100234567890',
            });
            ok('a FULL account number -> 400, refused rather than trimmed',
                fullAccount.status === 400 && /LAST 4/i.test(fullAccount.body?.message || ''),
                fullAccount.body?.message);

            const badIfsc = await call('POST', '/client/billing/payment-methods', {
                method_type: 'bank_transfer', bank_name: 'HDFC Bank',
                account_last4: '4242', ifsc: 'NOPE1',
            });
            ok('a malformed IFSC -> 400', badIfsc.status === 400, `got ${badIfsc.status}`);

            const [{ n: after }] = await sequelize.query(
                'SELECT COUNT(*) n FROM client_payment_methods WHERE website_client_id = ?',
                { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
            );
            ok('nothing was stored by any of those refusals', Number(after) === 0, `${after} rows`);

            const upi = await call('POST', '/client/billing/payment-methods', {
                method_type: 'upi', upi_id: 'Jamal@okHDFCbank', holder_name: 'Test Client',
            });
            ok('a valid UPI ID is SAVED with no gateway', upi.status === 200 || upi.status === 201,
                `got ${upi.status} ${upi.body?.message}`);
            const upiMethod = upi.body?.data?.method;
            ok('it is labelled once, by the server', upiMethod?.label === 'UPI · jamal@okhdfcbank',
                upiMethod?.label);
            ok('the UPI ID is normalised to lower case', upiMethod?.upi_id === 'jamal@okhdfcbank');
            ok('it is marked UNVERIFIED — the client typed it and nobody checked',
                upiMethod?.is_verified === false);
            ok('and NOT chargeable, so no screen can offer to charge it',
                upiMethod?.is_chargeable === false);
            ok('the first method becomes the default on its own',
                upiMethod?.is_default === true);
            ok('a manual row never expires', upiMethod?.is_expired === false);

            const dupe = await call('POST', '/client/billing/payment-methods', {
                method_type: 'upi', upi_id: 'jamal@okhdfcbank',
            });
            ok('the same UPI ID twice -> 400, not a second identical row',
                dupe.status === 400, `got ${dupe.status}`);

            const bank = await call('POST', '/client/billing/payment-methods', {
                method_type: 'bank_transfer', bank_name: 'HDFC Bank',
                account_last4: '4242', ifsc: 'hdfc0001234',
            });
            ok('a bank transfer is saved', bank.status === 200 || bank.status === 201,
                `got ${bank.status} ${bank.body?.message}`);
            ok('the bank label reads as an account, not as a card',
                bank.body?.data?.method?.label === 'HDFC Bank ending in 4242',
                bank.body?.data?.method?.label);
            ok('the IFSC is upper-cased', bank.body?.data?.method?.ifsc === 'HDFC0001234');

            /*
              The point of the whole change, asserted directly against the
              table: a manual method carries NO token, and there is nowhere in
              the row for a card number or an account number to be.
            */
            const [stored] = await sequelize.query(
                `SELECT gateway, gateway_payment_method_id, upi_id, account_last4, is_verified
                   FROM client_payment_methods WHERE website_client_id = ? AND gateway = 'manual'
                  ORDER BY id ASC LIMIT 1`,
                { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
            );
            ok('a manual row stores NO invented token',
                stored && stored.gateway === 'manual' && stored.gateway_payment_method_id === null,
                JSON.stringify(stored));

            const cols = await sequelize.query(
                `SELECT COLUMN_NAME c FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_payment_methods'`,
                { type: sequelize.QueryTypes.SELECT },
            );
            const names = cols.map((x) => x.c);
            const forbidden = names.filter((n) =>
                /^(card_number|card_no|pan|cvv|cvc|security_code|full_card|account_number|account_no)$/i
                    .test(n));
            ok('the table STILL has no card-number, CVC or full-account column',
                forbidden.length === 0, forbidden.join(','));

            // Cleared so the seeded-card section below starts from nothing.
            await sequelize.query(
                "DELETE FROM client_payment_methods WHERE website_client_id = ? AND gateway = 'manual'",
                { replacements: [clientId] });
        }

        // ── Read / default / remove, against seeded rows ───────────────────
        console.log('\n── list, default and remove ──────────────────────');
        const a = await seedCard(clientId, { is_default: true, last4: '4242' });
        const b = await seedCard(clientId, { last4: '8888', brand: 'mastercard' });
        const expired = await seedCard(clientId, { last4: '1111', exp_month: 1, exp_year: 2020 });

        {
            const list = await call('GET', '/client/billing/payment-methods');
            const methods = list.body?.data?.methods ?? [];
            ok('all three are listed', methods.length === 3, String(methods.length));
            ok('the default sorts first', methods[0]?.is_default === true);
            ok('a friendly label is built server-side',
                methods.find((m) => m.last4 === '8888')?.label === 'Mastercard ending in 8888',
                methods.find((m) => m.last4 === '8888')?.label);
            ok('the expiry label is padded once, on the server',
                methods.find((m) => m.last4 === '4242')?.expiry_label?.startsWith('06/'),
                methods.find((m) => m.last4 === '4242')?.expiry_label);
            ok('the lapsed card reports expired',
                methods.find((m) => m.last4 === '1111')?.is_expired === true);

            // ⚠ The single most important assertion in this file.
            const leaked = JSON.stringify(list.body).includes('tok_test_')
                || JSON.stringify(list.body).includes('gateway_payment_method_id');
            ok('the gateway TOKEN never leaves the server', !leaked);
        }

        {
            const res = await call('PUT', `/client/billing/payment-methods/${b.id}/default`);
            ok('a different card can be made default', res.status === 200, `got ${res.status}`);
            const methods = res.body?.data?.methods ?? [];
            ok('exactly ONE default afterwards',
                methods.filter((m) => m.is_default).length === 1,
                String(methods.filter((m) => m.is_default).length));
            ok('and it is the one asked for',
                methods.find((m) => m.is_default)?.id === b.id);
        }

        {
            const res = await call('PUT', `/client/billing/payment-methods/${expired.id}/default`);
            ok('an EXPIRED card cannot be made default', res.status === 400, `got ${res.status}`);
        }

        {
            const other = await call('PUT', '/client/billing/payment-methods/999999/default');
            ok("somebody else's card id -> 404", other.status === 404, `got ${other.status}`);
            const bad = await call('DELETE', '/client/billing/payment-methods/abc');
            ok('/payment-methods/abc -> 404, not queried as NaN', bad.status === 404, `got ${bad.status}`);
        }

        {
            // b is default; removing it must promote a usable card, not leave none.
            const res = await call('DELETE', `/client/billing/payment-methods/${b.id}`);
            ok('the default can be removed', res.status === 200, `got ${res.status}`);
            const methods = res.body?.data?.methods ?? [];
            ok('it is gone from the list', !methods.some((m) => m.id === b.id));
            ok('another card was promoted, so the account still has a default',
                methods.filter((m) => m.is_default).length === 1,
                JSON.stringify(methods.map((m) => [m.last4, m.is_default])));
            ok('and the promoted one is NOT the expired card',
                methods.find((m) => m.is_default)?.is_expired === false);
        }

        {
            // Soft delete — the invoices it paid still name it.
            const [row] = await sequelize.query(
                'SELECT deleted_at, status FROM client_payment_methods WHERE id = ?',
                { replacements: [b.id], type: sequelize.QueryTypes.SELECT },
            );
            ok('removal is a SOFT delete, so old invoices can still name the card',
                row && row.deleted_at !== null && row.status === 'removed', JSON.stringify(row));
        }
    } finally {
        console.log('\n── cleanup ───────────────────────────────────────');
        if (clientId) {
            await sequelize.query('DELETE FROM client_payment_methods WHERE website_client_id = ?',
                { replacements: [clientId] });
        }
        const [{ n }] = await sequelize.query(
            'SELECT COUNT(*) n FROM client_payment_methods WHERE website_client_id = ?',
            { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
        );
        ok('test rows removed', Number(n) === 0, `${n} remain`);
        await sequelize.close();
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
