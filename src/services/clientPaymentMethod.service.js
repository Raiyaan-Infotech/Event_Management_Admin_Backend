const { ClientPaymentMethod, sequelize } = require('../models');
const ApiError = require('../utils/apiError');

/**
 * Saved payment methods.
 *
 * ── ⚠ THE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────────
 * A card number never reaches this server. The gateway's own hosted field takes
 * the card in the browser and returns a token; the browser posts the TOKEN.
 *
 * `assertNoRawCard` below actively refuses a body that carries card-shaped
 * data, so the rule survives somebody later editing the form to "just send the
 * number". A rule that lives only in a comment is a rule that lasts until the
 * next person in a hurry.
 *
 * ── TWO WAYS A METHOD GETS HERE ─────────────────────────────────────────────
 * TOKENISED — a provider takes the card in the browser and hands back a token.
 *   `gatewayState()` reports whether one is configured. Adding by this route is
 *   still refused while it is not, and that refusal is NOT caution for its own
 *   sake: a token can only come from a provider, so a row created now would
 *   carry a made-up token that could never charge anything.
 *
 * MANUAL — no provider, which is this project's actual situation. Money arrives
 *   out of band (a UPI transfer, a bank transfer) and a payment is recorded
 *   afterwards by hand. Nothing auto-charges, so there is no renewal to fail —
 *   and the row is not a chargeable instrument at all but a RECORD OF HOW THE
 *   CLIENT PAYS, so the vendor knows what to expect and can match it against a
 *   statement.
 *
 * ⚠ The earlier refusal covered BOTH, and that was wrong. "A saved card that
 * cannot pay is a promise the next renewal breaks" is true of auto-billing and
 * meaningless here, where every payment is entered by a person.
 *
 * ── ⚠ WHAT NEITHER MODE MAY HOLD ────────────────────────────────────────────
 * No card number, no CVC — `assertNoRawCard()` applies to the manual path too.
 * That rule was never about the gateway: a full PAN makes this project a party
 * to PCI DSS, and a CVC may not be retained after authorisation by anybody.
 * The manual path also refuses a FULL BANK ACCOUNT NUMBER; last four plus the
 * IFSC is enough to recognise an account, and the rest is liability.
 *
 * A manual row is `is_verified = 0`, always. The client typed it; nobody
 * checked it, and the screens say so.
 */

/* ── Gateway state ───────────────────────────────────────────────────────── */

/**
 * Which provider is configured, if any.
 *
 * Read from the environment rather than a constant, so connecting a provider is
 * a deploy-time setting and not a code edit. Recognised keys are named
 * explicitly — an empty string must not read as "configured".
 */
const GATEWAYS = [
    { name: 'razorpay', keyVar: 'RAZORPAY_KEY_ID', publishableVar: 'RAZORPAY_KEY_ID' },
    { name: 'stripe', keyVar: 'STRIPE_SECRET_KEY', publishableVar: 'STRIPE_PUBLISHABLE_KEY' },
];

const gatewayState = () => {
    for (const g of GATEWAYS) {
        const secret = (process.env[g.keyVar] || '').trim();
        if (!secret) continue;
        return {
            enabled: true,
            gateway: g.name,
            // The PUBLISHABLE key is safe to hand the browser — it is what the
            // hosted card field needs in order to tokenise. The secret never
            // leaves this process.
            publishable_key: (process.env[g.publishableVar] || '').trim() || null,
            reason: null,
        };
    }
    return {
        enabled: false,
        gateway: null,
        publishable_key: null,
        reason:
            'No payment provider is connected, so a card cannot be saved here — '
            + 'a card is held by the provider, never by us. You can still record how '
            + 'you pay, and we will match your payment against it.',
    };
};

/* ── Manual methods ──────────────────────────────────────────────────────── */

/**
 * The method types a client may record by hand.
 *
 * Deliberately NOT 'card'. A card typed into this form would be four digits
 * nobody can verify, attached to an instrument this system cannot charge — it
 * would look like a saved card and behave like a note. UPI and bank transfer
 * are the two that carry a REFERENCE the vendor can reconcile against a bank
 * statement, which is the whole point of recording one.
 */
const MANUAL_TYPES = ['upi', 'bank_transfer', 'cash'];

const MANUAL_LABELS = { upi: 'UPI', bank_transfer: 'Bank transfer', cash: 'Cash' };

/**
 * NPCI's shape for a virtual payment address: handle@psp.
 *
 * Validated because a typo here means a payment that never arrives and nobody
 * knows why. It cannot prove the address RESOLVES — only the PSP can — which is
 * exactly why the row is still stored unverified.
 */
const UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,63}@[a-zA-Z][a-zA-Z0-9]{1,31}$/;

/** RBI's IFSC: four letters, a literal zero, then six alphanumerics. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Read a manual method out of a request body, or refuse it.
 *
 * Every message names the field and what a good value looks like: "invalid" on
 * a form somebody typed by hand is the least useful answer available.
 */
function readManual(body = {}) {
    const type = String(body.method_type || '').trim().toLowerCase();
    if (!MANUAL_TYPES.includes(type)) {
        throw ApiError.badRequest(
            `Choose how you pay: ${MANUAL_TYPES.map((t) => MANUAL_LABELS[t]).join(', ')}.`,
        );
    }

    const holder = body.holder_name ? String(body.holder_name).trim().slice(0, 120) : null;

    /*
      Cash carries no identifiers at all — no address, no account, nothing that
      could ever double as a reference. It exists so a client whose event was
      paid for in cash has something to pick as their record, rather than being
      forced into a UPI or bank field that names a route the money never took.
    */
    if (type === 'cash') {
        return { method_type: 'cash', holder_name: holder };
    }

    if (type === 'upi') {
        const upi = String(body.upi_id || '').trim();
        if (!upi) throw ApiError.badRequest('Enter your UPI ID.');
        if (!UPI_RE.test(upi)) {
            throw ApiError.badRequest(
                'That does not look like a UPI ID. It should look like name@bank.',
            );
        }
        return {
            method_type: 'upi',
            upi_id: upi.toLowerCase(),
            holder_name: holder,
        };
    }

    const bank = String(body.bank_name || '').trim();
    if (!bank) throw ApiError.badRequest('Enter the name of your bank.');

    /*
      ⚠ Exactly four digits, and a longer value is REFUSED rather than trimmed.

      Trimming would be friendlier and would also mean the full account number
      had already been sent to this server and could sit in a request log. The
      form asks for four; the server insists on four.
    */
    const raw = String(body.account_last4 || '').replace(/[\s-]/g, '');
    if (!/^\d{4}$/.test(raw)) {
        throw ApiError.badRequest(
            raw.length > 4
                ? 'Enter only the LAST 4 digits of your account number, not the whole number.'
                : 'Enter the last 4 digits of your account number.',
        );
    }

    const ifsc = String(body.ifsc || '').trim().toUpperCase();
    if (ifsc && !IFSC_RE.test(ifsc)) {
        throw ApiError.badRequest('That is not a valid IFSC. It looks like HDFC0001234.');
    }

    return {
        method_type: 'bank_transfer',
        bank_name: bank.slice(0, 120),
        account_last4: raw,
        ifsc: ifsc || null,
        holder_name: holder,
    };
}

/* ── Guards ──────────────────────────────────────────────────────────────── */

/**
 * ⚠ Refuse anything that looks like real card data.
 *
 * Checked on the KEYS as well as the values: a body carrying `card_number`,
 * `cvv` or 13–19 consecutive digits is either a mistake or a form that has been
 * rewired to post the card here. Either way the correct answer is to reject it
 * loudly, not to store it and mention it in a comment.
 *
 * Deliberately does NOT log the offending value.
 */
const CARDISH_KEY = /^(card_number|card_no|cardnumber|pan|cvv|cvc|card_cvv|security_code|expiry|exp_date)$/i;

function assertNoRawCard(body = {}) {
    for (const [key, value] of Object.entries(body)) {
        if (CARDISH_KEY.test(key)) {
            throw ApiError.badRequest(
                'Card details must never be sent to this server. '
                + 'The payment provider takes the card in your browser and returns a token; '
                + 'send that token instead.',
            );
        }
        if (typeof value === 'string') {
            // 13–19 digits, ignoring the spaces and dashes people type.
            const digits = value.replace(/[\s-]/g, '');
            if (/^\d{13,19}$/.test(digits) && luhn(digits)) {
                throw ApiError.badRequest(
                    'That looks like a card number. Card details must never be sent to this '
                    + 'server — send the token the payment provider gives your browser.',
                );
            }
        }
    }
}

/**
 * Luhn check, so a 16-digit ORDER REFERENCE is not mistaken for a card.
 * Every real card number passes it; arbitrary digit strings mostly do not.
 */
function luhn(digits) {
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
        let d = digits.charCodeAt(i) - 48;
        if (double) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
        double = !double;
    }
    return sum % 10 === 0;
}

/** The design says five; enforced HERE, because a UI limit is not a limit. */
const MAX_METHODS = 5;

/* ── Shaping ─────────────────────────────────────────────────────────────── */

/**
 * A card is expired from the END of its expiry month — a card marked 06/27 is
 * good through 30 June 2027. Getting this wrong by one month tells somebody
 * their working card has expired.
 */
function isExpired(row, now = new Date()) {
    if (!row.exp_month || !row.exp_year) return false;
    /*
      ⚠ UTC, not local time.

      `new Date(2027, 6, 1)` is midnight in whatever zone the SERVER happens to
      run in, so a card on its very last day reads as expired in one deployment
      and valid in another — Render is UTC, this machine is IST, and the two
      would disagree for five and a half hours every month-end. A card expiry is
      a calendar fact with no zone attached, so it is compared in UTC and
      answers the same everywhere.

      The month is deliberately NOT decremented: `Date.UTC(y, m, 1)` with a
      1-based month is already the first instant of the FOLLOWING month, which
      is exactly when a card marked 06/27 stops being valid.
    */
    const expiresAt = Date.UTC(Number(row.exp_year), Number(row.exp_month), 1);
    return now.getTime() >= expiresAt;
}

/**
 * One line that names a method, whatever kind it is.
 *
 * Decided HERE, once, so the list, the invoice, the Billing Summary and a
 * payment's snapshot cannot word the same method four ways.
 */
function methodLabel(j) {
    if (j.method_type === 'cash') return 'Cash';
    if (j.method_type === 'upi') return `UPI · ${j.upi_id}`;
    if (j.method_type === 'bank_transfer') {
        const bank = j.bank_name || 'Bank account';
        return j.account_last4 ? `${bank} ending in ${j.account_last4}` : bank;
    }
    if (j.last4) return `${titleCase(j.brand) || 'Card'} ending in ${j.last4}`;
    return titleCase(j.method_type) || 'Payment method';
}

function shape(row) {
    const j = row.toJSON ? row.toJSON() : row;
    const expired = isExpired(j);
    return {
        id: j.id,
        gateway: j.gateway,
        method_type: j.method_type,
        brand: j.brand,
        last4: j.last4,
        upi_id: j.upi_id ?? null,
        bank_name: j.bank_name ?? null,
        account_last4: j.account_last4 ?? null,
        ifsc: j.ifsc ?? null,
        is_verified: Boolean(j.is_verified),
        /*
          Whether this row could ever be CHARGED, as opposed to merely recorded.
          A manual method never can — the money has to arrive on its own — and
          the screens must not offer it as though it could.
        */
        is_chargeable: j.gateway !== 'manual',
        exp_month: j.exp_month,
        exp_year: j.exp_year,
        // "06/27" — assembled here so three screens cannot pad it three ways.
        expiry_label: j.exp_month && j.exp_year
            ? `${String(j.exp_month).padStart(2, '0')}/${String(j.exp_year).slice(-2)}`
            : null,
        holder_name: j.holder_name,
        is_default: Boolean(j.is_default),
        is_expired: expired,
        status: expired && j.status === 'active' ? 'expired' : j.status,
        label: methodLabel(j),
        // "UPI" / "Bank transfer" / "Card" — for a heading, where the full
        // label would repeat the detail printed underneath it.
        type_label: MANUAL_LABELS[j.method_type] || 'Card',
        created_at: j.created_at,
        /*
          ⚠ The token is NOT returned. The client has no use for it and it is the
          one field worth keeping off the wire — a token plus a leaked secret key
          is a chargeable card.
        */
    };
}

const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : null);

/* ── Reads ───────────────────────────────────────────────────────────────── */

const listPaymentMethods = async (client) => {
    const rows = await ClientPaymentMethod.findAll({
        where: { website_client_id: client.id },
        order: [['is_default', 'DESC'], ['created_at', 'DESC']],
    });

    const methods = rows.map(shape);
    const gateway = gatewayState();

    return {
        methods,
        default_method: methods.find((m) => m.is_default) ?? null,
        max_methods: MAX_METHODS,
        // The cap is the only thing that stops adding now — a missing provider
        // no longer does, because the manual route needs none.
        can_add: methods.length < MAX_METHODS,
        gateway: {
            enabled: gateway.enabled,
            name: gateway.gateway,
            publishable_key: gateway.publishable_key,
            reason: gateway.reason,
        },
        manual: {
            enabled: true,
            types: MANUAL_TYPES.map((t) => ({ value: t, label: MANUAL_LABELS[t] })),
            /*
              Said once, by the server, so the form does not have to promise
              anything on its own account. It is the sentence that keeps a
              recorded method from reading like a saved card.
            */
            reason:
                'This records how you pay so we can match your payment when it arrives. '
                + 'Nothing is charged automatically, and we never hold your card details.',
        },
    };
};

/* ── Writes ──────────────────────────────────────────────────────────────── */

/**
 * Save a payment method.
 *
 * Which mode is decided by what arrived, not by a flag the caller chooses: a
 * body carrying a provider token is tokenised, anything else is manual. A flag
 * would let a browser ask for the tokenised path without a token and get the
 * wrong error.
 *
 * The card guard runs FIRST in both modes, before anything reads the body.
 */
const addPaymentMethod = async (client, body = {}) => {
    // First, before anything else touches the body.
    assertNoRawCard(body);

    const token = String(body.gateway_payment_method_id || body.token || '').trim();
    const gateway = gatewayState();

    const count = await ClientPaymentMethod.count({ where: { website_client_id: client.id } });
    if (count >= MAX_METHODS) {
        throw ApiError.badRequest(
            `You can save up to ${MAX_METHODS} payment methods. Remove one before adding another.`,
        );
    }

    let fields;

    if (token) {
        /*
          The tokenised path, unchanged. A token that did not come from a
          configured provider cannot charge anything, so accepting one would
          store a saved card that silently fails at the first renewal.

          503, not 400: the request is fine, the capability is missing.
        */
        if (!gateway.enabled) throw ApiError.serviceUnavailable(gateway.reason);

        fields = {
            gateway: gateway.gateway,
            gateway_customer_id: body.gateway_customer_id || null,
            gateway_payment_method_id: token,
            brand: body.brand ? String(body.brand).toLowerCase().slice(0, 30) : null,
            last4: String(body.last4 || '').replace(/\D/g, '').slice(-4) || null,
            exp_month: body.exp_month ? Number(body.exp_month) : null,
            exp_year: body.exp_year ? Number(body.exp_year) : null,
            holder_name: body.holder_name ? String(body.holder_name).slice(0, 120) : null,
            method_type: body.method_type || 'card',
            // The provider checked the card. Nobody has to take our word for it.
            is_verified: true,
        };
    } else {
        const manual = readManual(body);

        /*
          The same UPI ID or the same account twice is a mistake, not a second
          method — and two identical rows make "which one is the default"
          meaningless. Caught here rather than by a unique index because the
          index would have to be on nullable columns and could not say this.
        */
        // Cash has no field to match on — a second row would be identical to the
        // first, so the clash is simply "one already exists".
        const clash = await ClientPaymentMethod.findOne({
            where: {
                website_client_id: client.id,
                ...(manual.method_type === 'cash'
                    ? { method_type: 'cash' }
                    : manual.method_type === 'upi'
                        ? { upi_id: manual.upi_id }
                        : { account_last4: manual.account_last4, bank_name: manual.bank_name }),
            },
        });
        if (clash) {
            throw ApiError.badRequest(
                manual.method_type === 'cash'
                    ? 'You have already saved Cash as a payment method.'
                    : 'You have already saved that payment method.',
            );
        }

        fields = {
            gateway: 'manual',
            gateway_payment_method_id: null,
            ...manual,
            // Client-typed and unchecked, always. Nothing on this path can
            // set it true, which is the point.
            is_verified: false,
        };
    }

    return sequelize.transaction(async (t) => {
        const makeDefault = count === 0 || body.is_default === true || body.is_default === 'true';

        if (makeDefault) await clearDefault(client.id, t);

        const row = await ClientPaymentMethod.create({
            website_client_id: client.id,
            company_id: client.company_id ?? null,
            ...fields,
            is_default: makeDefault,
        }, { transaction: t });

        return shape(row);
    });
};

/**
 * Exactly one default, enforced in a TRANSACTION.
 *
 * Clearing then setting in two separate statements can leave a client with no
 * default at all if the second fails — and "no default" is the state that makes
 * a renewal silently not charge.
 */
const clearDefault = (clientId, transaction) =>
    ClientPaymentMethod.update(
        { is_default: false },
        { where: { website_client_id: clientId, is_default: true }, transaction },
    );

const setDefaultPaymentMethod = async (client, id) => {
    const row = await findOwned(client, id);

    if (isExpired(row)) {
        // Refused rather than allowed-with-a-warning: a default is the card the
        // next renewal charges, and an expired one guarantees that fails.
        throw ApiError.badRequest('That card has expired. Add a current one to use as your default.');
    }

    await sequelize.transaction(async (t) => {
        await clearDefault(client.id, t);
        await row.update({ is_default: true }, { transaction: t });
    });

    return listPaymentMethods(client);
};

/**
 * Remove one.
 *
 * Soft delete — the invoices it paid still name it. Removing the DEFAULT
 * promotes the next usable card rather than leaving the client with none, and
 * says which one it promoted.
 */
const removePaymentMethod = async (client, id) => {
    const row = await findOwned(client, id);
    const wasDefault = Boolean(row.is_default);

    await sequelize.transaction(async (t) => {
        await row.update({ is_default: false, status: 'removed' }, { transaction: t });
        await row.destroy({ transaction: t });

        if (wasDefault) {
            const next = await ClientPaymentMethod.findOne({
                where: { website_client_id: client.id },
                order: [['created_at', 'DESC']],
                transaction: t,
            });
            // Only promote a card that could actually be charged.
            if (next && !isExpired(next)) {
                await next.update({ is_default: true }, { transaction: t });
            }
        }
    });

    return listPaymentMethods(client);
};

/**
 * Scoped to the SESSION's client, always.
 *
 * A 404 rather than a 403 for somebody else's row: confirming that an id exists
 * but belongs to another account is itself a leak. Same shape as the invoice
 * lookup (§325).
 */
async function findOwned(client, id) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric < 1) {
        // Guarded before the query so `/payment-methods/abc` is not sent to
        // MySQL as NaN — the §325 case, in the same family of routes.
        throw ApiError.notFound('Payment method not found.');
    }
    const row = await ClientPaymentMethod.findOne({
        where: { id: numeric, website_client_id: client.id },
    });
    if (!row) throw ApiError.notFound('Payment method not found.');
    return row;
}

module.exports = {
    listPaymentMethods,
    addPaymentMethod,
    setDefaultPaymentMethod,
    removePaymentMethod,
    gatewayState,
    /*
      The one place that decides how a method is worded. `clientInvoice.service`
      snapshots this string onto a payment, so an invoice and the screen the
      client saved the method on cannot disagree. No cycle: this module requires
      only the models.
    */
    labelFor: methodLabel,
    MANUAL_TYPES,
    // Exported for the tests — these are the behaviours worth locking.
    assertNoRawCard,
    readManual,
    isExpired,
    MAX_METHODS,
};
