const {
    Sequelize,
    sequelize,
    WebsiteClient,
    SubscriptionPlan,
    ClientInvoice,
    ClientInvoiceItem,
    ClientTransaction,
    ClientSubscriptionEvent,
    ClientSalesEnquiry,
    ClientPaymentMethod,
} = require('../models');
// Only the label renderer — one place decides how a method is worded, and a
// payment's snapshot has to match the screen the client saved it on.
const paymentMethods = require('./clientPaymentMethod.service');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');

/**
 * Client-portal Billing, Phase 2 — invoices, the money ledger, sales enquiries.
 *
 * ── NOTHING HERE TAKES A PAYMENT ────────────────────────────────────────────
 * There is no payment provider in this project. An invoice is RAISED when a
 * billing term begins and then sits at `issued` — nothing moves it to `paid`,
 * because nothing can. That is reported honestly: every screen says online
 * payment is not enabled rather than showing a Pay button that does nothing.
 *
 * `recordPayment()` exists and is deliberately NOT reachable from any client
 * route. It is the seam a gateway webhook plugs into, and until then the only
 * caller would be an admin recording a transfer received out of band.
 *
 * ── DELIBERATELY NO PDF ─────────────────────────────────────────────────────
 * The design's "Download Invoice (PDF)" would need a PDF renderer this backend
 * does not have. The API serves the invoice as data and the portal renders a
 * printable view — the browser's own print-to-PDF produces a real file, rather
 * than adding a dependency to produce a worse one.
 */

/* ─────────────────────────────────────────────────────────────────────────────
 * Money
 * ────────────────────────────────────────────────────────────────────────── */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Whether money can actually be taken. ONE constant, read everywhere.
 *
 * ⚠ Flip this to true only when a payment provider is genuinely wired. Two
 * behaviours hang off it, and both are wrong the moment it lies:
 *
 *  1. **Due dates are not stamped while it is false.** An invoice nobody has any
 *     way to pay cannot be overdue, and `displayStatus` derives "overdue" from a
 *     due date — so leaving it set showed a red OVERDUE badge for a payment
 *     route that does not exist. That is shaming somebody for our missing
 *     integration.
 *  2. Every payload carries it as `payments_enabled`, so the screens describe
 *     the real state rather than each hardcoding an assumption.
 */
const PAYMENTS_ENABLED = false;

const PAYMENTS_DISABLED_REASON =
    'Online payment is not enabled yet. Please contact us to settle an invoice.';

/**
 * Tax, EXCLUSIVE — added on top of (subtotal - discount).
 *
 * Split into CGST + SGST at half the rate each, which is what the supplied
 * invoice design shows.
 *
 * ⚠ That split assumes an INTRA-STATE supply. An inter-state one is a single
 * IGST line at the full rate, and choosing between them needs a place-of-supply
 * comparison — the company's state against the client's, neither of which is
 * stored anywhere in this schema. The breakdown is JSON precisely so switching
 * is data rather than a migration.
 */
const computeTotals = ({ subtotal, discount = 0, taxRate = 18 }) => {
    const sub = round2(subtotal);
    const disc = round2(discount);
    const taxable = round2(sub - disc);
    const rate = Number(taxRate) || 0;
    const tax = round2((taxable * rate) / 100);

    const half = round2(tax / 2);
    // Gated on the TAX, not the rate. A free plan at an 18% rate still owes
    // nothing, and emitting "CGST (9%) ₹0.00 / SGST (9%) ₹0.00" on a zero
    // invoice is two lines of noise implying a charge that is not there.
    const breakdown = tax > 0
        ? [
            { label: 'CGST', rate: round2(rate / 2), amount: half },
            // The second half absorbs any rounding remainder, so the two
            // components always sum EXACTLY to tax_amount. Splitting an odd
            // paisa evenly is what makes an invoice fail to add up.
            { label: 'SGST', rate: round2(rate / 2), amount: round2(tax - half) },
        ]
        : [];

    return {
        subtotal: sub,
        discount_amount: disc,
        tax_rate: rate,
        tax_amount: tax,
        tax_breakdown: breakdown,
        tax_inclusive: 0,
        total: round2(taxable + tax),
    };
};

/**
 * The status to SHOW.
 *
 * `unpaid` and `overdue` are DERIVED, not stored — a stored `unpaid` would need
 * something to move it off, and with no payment provider nothing ever would, so
 * the column and reality would diverge on day one.
 */
const displayStatus = (inv, now = new Date()) => {
    if (inv.status === 'cancelled') return 'cancelled';
    if (inv.status === 'refunded') return 'refunded';
    if (inv.status === 'draft') return 'draft';

    const paid = Number(inv.amount_paid) || 0;
    const due = Number(inv.amount_due) || 0;

    if (due <= 0 && paid > 0) return 'paid';
    if (paid > 0 && due > 0) return 'partially_paid';
    // No due date is stamped while payments are disabled, so this branch cannot
    // fire today — and must not, or an unpayable invoice reads as the client's
    // fault. See PAYMENTS_ENABLED.
    if (inv.due_date && new Date(inv.due_date) < now) return 'overdue';
    return 'unpaid';
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Numbering
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The next invoice number for a company, INV-YYYY-NNNNNN.
 *
 * Taken inside the caller's TRANSACTION with a row lock on the company's
 * existing invoices. Two terms rolling over at once would otherwise both read
 * the same MAX and collide on `uniq_client_invoice_number` — and the unique
 * index is what makes that a caught error rather than two invoices with one
 * number.
 */
const nextInvoiceNumber = async (companyId, year, transaction) => {
    const prefix = `INV-${year}-`;
    const [rows] = await sequelize.query(
        `SELECT invoice_number FROM client_invoices
          WHERE ${companyId === null ? 'company_id IS NULL' : 'company_id = :companyId'}
            AND invoice_number LIKE :prefix
          ORDER BY invoice_number DESC
          LIMIT 1
          FOR UPDATE`,
        {
            replacements: { companyId, prefix: `${prefix}%` },
            transaction,
        },
    );

    const last = rows.length ? String(rows[0].invoice_number) : null;
    const seq = last ? Number(last.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Raising an invoice
 * ────────────────────────────────────────────────────────────────────────── */

const asDate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

/**
 * Raise the invoice for one billing term.
 *
 * ⚠ IDEMPOTENT on (subscription, period_start). Term rollover is applied lazily
 * on read, so two requests landing together would otherwise each raise an
 * invoice for the same month. Returns the existing row instead of a second one.
 *
 * Also writes the matching `invoice` row into the money ledger, in the SAME
 * transaction — an invoice that exists with no ledger entry would be missing
 * from the history screen, which is the one place somebody would look for it.
 */
const raiseInvoiceForTerm = async (subscription, {
    periodStart,
    periodEnd,
    issueDate = new Date(),
    planName = null,
    dueInDays = 7,
} = {}) => {
    if (!subscription) return null;

    const start = asDate(periodStart ?? subscription.current_period_start);
    const end = asDate(periodEnd ?? subscription.current_period_end);

    const existing = await ClientInvoice.findOne({
        where: {
            client_subscription_id: subscription.id,
            period_start: start,
        },
    });
    if (existing) return existing;

    /**
     * Only the three fields the invoice actually snapshots.
     *
     * ⚠ Not the whole row, deliberately. An unqualified findByPk selects EVERY
     * column the model declares, so the query breaks on any column the model
     * knows about and the database has not got yet — which is exactly how this
     * failed on production, where `company_name` and `bio` had not been applied.
     * Naming the columns makes the read immune to drift it does not care about.
     */
    const client = await WebsiteClient.findByPk(subscription.website_client_id, {
        attributes: ['id', 'company_id', 'name', 'email'],
    });
    const plan = subscription.subscription_plan_id
        ? await SubscriptionPlan.findByPk(subscription.subscription_plan_id, { attributes: ['id', 'name'] })
        : null;

    const label = planName || plan?.name || 'Subscription';
    const price = Number(subscription.price) || 0;
    const totals = computeTotals({ subtotal: price, taxRate: subscription.tax_rate ?? 18 });

    const issue = new Date(issueDate);
    // Only stamped when money can actually be taken — see PAYMENTS_ENABLED.
    const due = PAYMENTS_ENABLED ? new Date(issue.getTime() + dueInDays * 86400000) : null;

    return sequelize.transaction(async (t) => {
        const number = await nextInvoiceNumber(
            client?.company_id ?? null,
            issue.getFullYear(),
            t,
        );

        const invoice = await ClientInvoice.create({
            invoice_number: number,
            website_client_id: subscription.website_client_id,
            client_subscription_id: subscription.id,
            subscription_plan_id: subscription.subscription_plan_id,
            company_id: client?.company_id ?? null,
            status: 'issued',
            issue_date: asDate(issue),
            due_date: due ? asDate(due) : null,
            period_start: start,
            period_end: end,
            currency_code: subscription.currency_code || 'INR',
            ...totals,
            amount_paid: 0,
            // Nothing can pay this, so the entire total is outstanding.
            amount_due: totals.total,
            // Snapshot: an invoice records who was billed AT THE TIME. The
            // address fields stay null — website_clients has no address columns.
            billing_name: client?.name ?? null,
            billing_email: client?.email ?? null,
            billing_address: null,
            billing_gstin: null,
            notes: PAYMENTS_ENABLED ? null : PAYMENTS_DISABLED_REASON,
        }, { transaction: t });

        await ClientInvoiceItem.create({
            invoice_id: invoice.id,
            item_type: 'plan',
            description: `${label} subscription`,
            period_start: start,
            period_end: end,
            quantity: 1,
            unit_price: price,
            amount: price,
            sort_order: 0,
        }, { transaction: t });

        await ClientTransaction.create({
            website_client_id: subscription.website_client_id,
            client_subscription_id: subscription.id,
            invoice_id: invoice.id,
            company_id: client?.company_id ?? null,
            type: 'invoice',
            status: 'completed',
            description: `Invoice ${number} — ${label}`,
            // Positive: raised against the client, i.e. owed.
            amount: totals.total,
            currency_code: subscription.currency_code || 'INR',
            reference: number,
            occurred_at: issue,
        }, { transaction: t });

        return invoice;
    });
};

/**
 * Record money received against an invoice.
 *
 * ⚠ NOT reachable from any client route, deliberately. This is the seam a
 * gateway webhook plugs into; exposing it to the portal would let a client mark
 * their own invoice paid.
 */
const recordPayment = async (invoiceId, {
    amount, reference = null, gateway = null, gatewayTransactionId = null,
    paymentMethodId = null, occurredAt = new Date(),
}) => {
    const invoice = await ClientInvoice.findByPk(invoiceId);
    if (!invoice) throw ApiError.notFound('Invoice not found.');

    /*
      The card is SNAPSHOT here, at payment time, not joined at read time.

      ⚠ Only the two display fields are copied — brand and last four. Those are
      the only card fields this system has at all; there is no card number and
      no CVC to copy, by design (§341).

      Scoped to the invoice's own client, so a crafted id cannot attach somebody
      else's card to this payment. `paranoid: false` because a card that was
      removed after paying is exactly the case the snapshot exists for.
    */
    let method = null;
    if (paymentMethodId) {
        method = await ClientPaymentMethod.findOne({
            where: { id: paymentMethodId, website_client_id: invoice.website_client_id },
            paranoid: false,
        });
        if (!method) throw ApiError.badRequest('That payment method is not on this account.');
    }

    const paid = round2(Number(invoice.amount_paid) + Number(amount));
    const due = round2(Number(invoice.total) - paid);

    return sequelize.transaction(async (t) => {
        await invoice.update({
            amount_paid: paid,
            amount_due: due > 0 ? due : 0,
            status: due <= 0 ? 'paid' : 'partially_paid',
            paid_at: due <= 0 ? occurredAt : invoice.paid_at,
        }, { transaction: t });

        await ClientTransaction.create({
            website_client_id: invoice.website_client_id,
            client_subscription_id: invoice.client_subscription_id,
            invoice_id: invoice.id,
            company_id: invoice.company_id,
            type: 'payment',
            status: 'successful',
            description: `Payment for ${invoice.invoice_number}`,
            // Negative: money leaving the client, which is what makes the
            // history column's "- ₹1,499.00" fall out of the data.
            amount: -Math.abs(round2(amount)),
            currency_code: invoice.currency_code,
            reference: reference || invoice.invoice_number,
            gateway: gateway || method?.gateway || null,
            gateway_transaction_id: gatewayTransactionId,
            client_payment_method_id: method?.id ?? null,
            method_brand: method?.brand ?? null,
            // A UPI method has no last four of its own; the bank one's live in
            // `account_last4`. Both end up in the label, which is what prints.
            method_last4: method?.last4 ?? method?.account_last4 ?? null,
            method_label: method ? paymentMethods.labelFor(method) : null,
            occurred_at: occurredAt,
        }, { transaction: t });

        return invoice;
    });
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Reading
 * ────────────────────────────────────────────────────────────────────────── */


/* ─────────────────────────────────────────────────────────────────────────────
 * Amount in words
 * ────────────────────────────────────────────────────────────────────────── */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
    'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const underThousand = (n) => {
    if (n === 0) return '';
    if (n < 20) return ONES[n];
    if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
    return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${underThousand(n % 100)}` : ''}`;
};

/**
 * "One Thousand Four Hundred Ninety Nine Rupees Only" — the line every Indian
 * invoice carries, and the one on the supplied design.
 *
 * ── INDIAN GROUPING, NOT WESTERN ────────────────────────────────────────────
 * Crore / lakh / thousand, NOT million / billion. Every plan here is priced in
 * INR and this is an Indian tax invoice; "1.5 million rupees" on a GST invoice
 * is wrong in the way a reader notices immediately.
 *
 * Paise are spoken separately ("… and Fifty Paise") rather than as a decimal,
 * which is how the amount is read aloud and how it is written on a cheque.
 * Rounded to 2dp FIRST, so 0.005 cannot print as zero paise while the total
 * beside it shows one.
 */
function amountInWords(value, currencyCode = 'INR') {
    const amount = round2(Math.abs(Number(value) || 0));
    // Only INR has a rupees/paise reading. Anything else gets no words at all
    // rather than rupee wording over a different currency's number.
    if (String(currencyCode).toUpperCase() !== 'INR') return null;

    const whole = Math.floor(amount);
    const paise = Math.round((amount - whole) * 100);

    if (whole === 0 && paise === 0) return 'Zero Rupees Only';

    const parts = [];
    const push = (n, label) => { if (n) parts.push(`${underThousand(n)} ${label}`); };

    push(Math.floor(whole / 10000000), 'Crore');
    push(Math.floor((whole % 10000000) / 100000), 'Lakh');
    push(Math.floor((whole % 100000) / 1000), 'Thousand');
    const rest = whole % 1000;
    if (rest) parts.push(underThousand(rest));

    // Singular for exactly one. "One Rupees Only" on a printed invoice is the
    // kind of thing a client screenshots.
    const rupees = parts.length ? `${parts.join(' ')} ${whole === 1 ? 'Rupee' : 'Rupees'}` : '';
    const paiseText = paise ? `${underThousand(paise)} ${paise === 1 ? 'Paisa' : 'Paise'}` : '';

    if (rupees && paiseText) return `${rupees} and ${paiseText} Only`;
    return `${rupees || paiseText} Only`;
}


/**
 * The invoice's own history, assembled from timestamps that already exist.
 *
 * Only real events appear. An unpaid invoice gets one entry, not a greyed-out
 * "awaiting payment" step — a timeline that shows steps which have not happened
 * reads as a process that is stuck rather than one that has not started.
 */
function buildTimeline(j) {
    const entries = [{
        key: 'created',
        label: 'Invoice created',
        detail: `Invoice ${j.invoice_number} was created.`,
        at: j.created_at || j.issue_date,
    }];

    for (const tx of j.transactions || []) {
        if (tx.type === 'payment') {
            // Names the card when one is recorded — "…received via Visa ending
            // in 4242" — from the transaction's own snapshot, so the line stays
            // true after the card is removed.
            const via = tx.method_label
                ? ` via ${tx.method_label}`
                : tx.method_last4
                    ? ` via ${titleCase(tx.method_brand) || 'card'} ending in ${tx.method_last4}`
                    : '';
            entries.push({
                key: `payment-${tx.id}`,
                label: 'Payment received',
                detail: `${tx.description || 'Payment received'}${via}.`,
                at: tx.occurred_at,
            });
        }
        if (tx.type === 'refund') {
            entries.push({
                key: `refund-${tx.id}`,
                label: 'Refund issued',
                detail: tx.description || 'Refund issued.',
                at: tx.occurred_at,
            });
        }
    }

    if (j.paid_at) {
        entries.push({
            key: 'paid',
            label: 'Invoice paid',
            detail: 'Invoice marked as paid.',
            at: j.paid_at,
        });
    }

    return entries
        .filter((e) => e.at)
        .sort((a, b) => new Date(a.at) - new Date(b.at));
}

/**
 * How a payment names the card that made it.
 *
 * Read from the transaction's own SNAPSHOT columns, never by joining the live
 * card row. An archived invoice must keep saying what it said the day it was
 * settled — if the client later edits the holder name or removes the card, the
 * receipt cannot quietly change with it. `client_payment_method_id` is still
 * carried so a screen that wants the live card (its expiry, its status) can
 * follow it deliberately.
 *
 * Returns null when there is nothing to say, which is every payment today:
 * no provider is connected, so nothing has been paid by card.
 */
const shapeMethod = (tx) => {
    if (!tx) return null;
    if (!tx.method_label && !tx.method_brand && !tx.method_last4 && !tx.gateway) return null;
    const brand = titleCase(tx.method_brand);
    return {
        payment_method_id: tx.client_payment_method_id ?? null,
        brand: tx.method_brand ?? null,
        last4: tx.method_last4 ?? null,
        gateway: tx.gateway ?? null,
        gateway_transaction_id: tx.gateway_transaction_id ?? null,
        /*
          The label the payment-method service rendered at payment time, kept
          verbatim. Reassembling it from brand + last4 only works for a card —
          a UPI address has neither — and would also let this invoice word the
          same method differently from the screen the client saved it on.
        */
        label: tx.method_label
            || (tx.method_last4
                ? `${brand || 'Card'} ending in ${tx.method_last4}`
                : brand || titleCase(tx.gateway) || 'Payment method'),
    };
};

const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : null);

/** The payment that settled an invoice — the most recent successful one. */
const settlingPayment = (txs = []) =>
    txs
        .filter((t) => t.type === 'payment' && t.status !== 'failed')
        .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))[0] ?? null;

const shapeInvoice = (inv, { withItems = false } = {}) => {
    const j = inv.toJSON ? inv.toJSON() : inv;
    return {
        id: j.id,
        invoice_number: j.invoice_number,
        status: displayStatus(j),
        stored_status: j.status,
        issue_date: j.issue_date,
        due_date: j.due_date,
        paid_at: j.paid_at,
        period_start: j.period_start,
        period_end: j.period_end,
        currency_code: j.currency_code,
        // The line an Indian tax invoice is expected to carry. Computed here so
        // the words and the figure can never disagree.
        amount_in_words: amountInWords(j.total, j.currency_code),
        subtotal: Number(j.subtotal),
        discount_amount: Number(j.discount_amount),
        tax_rate: Number(j.tax_rate),
        tax_amount: Number(j.tax_amount),
        tax_breakdown: j.tax_breakdown || [],
        tax_inclusive: Number(j.tax_inclusive) === 1,
        total: Number(j.total),
        amount_paid: Number(j.amount_paid),
        amount_due: Number(j.amount_due),
        billing_name: j.billing_name,
        billing_email: j.billing_email,
        billing_address: j.billing_address,
        billing_gstin: j.billing_gstin,
        notes: j.notes,
        plan: j.plan || null,
        created_at: j.created_at,
        ...(withItems
            ? {
                items: (j.items || []).map((it) => ({
                    id: it.id,
                    item_type: it.item_type,
                    description: it.description,
                    period_start: it.period_start,
                    period_end: it.period_end,
                    quantity: Number(it.quantity),
                    unit_price: Number(it.unit_price),
                    amount: Number(it.amount),
                })),
                transactions: (j.transactions || []).map((tx) => ({
                    id: tx.id,
                    type: tx.type,
                    status: tx.status,
                    description: tx.description,
                    amount: Number(tx.amount),
                    reference: tx.reference,
                    gateway: tx.gateway,
                    gateway_transaction_id: tx.gateway_transaction_id,
                    payment_method: shapeMethod(tx),
                    occurred_at: tx.occurred_at,
                })),
                /*
                  The card that settled THIS invoice, lifted to the top so the
                  Payment Summary panel does not have to pick a transaction out
                  of the ledger and re-derive "which one was the payment".
                */
                payment_method: shapeMethod(settlingPayment(j.transactions || [])),
                /*
                  The "Invoice Timeline" on the design.

                  DERIVED from what happened, never stored: every entry is an
                  existing row's timestamp. A stored timeline would be a third
                  place for the same facts and the first to fall out of step —
                  the reason `client_transactions` and `client_subscription_events`
                  are merged at read time rather than copied (§320).
                */
                timeline: buildTimeline(j),
            }
            : {}),
    };
};

/** The Invoices list, its filters and its stat tiles. */
const listInvoices = async (clientId, { status, search, from, to, page = 1, limit = 10 } = {}) => {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 10));

    const where = { website_client_id: clientId };
    if (search) where.invoice_number = { [Op.like]: `%${String(search).trim()}%` };
    if (from || to) {
        where.issue_date = {};
        if (from) where.issue_date[Op.gte] = from;
        if (to) where.issue_date[Op.lte] = to;
    }
    // `unpaid`, `overdue` and `paid` are DERIVED, so they cannot go into the
    // WHERE clause. Stored statuses filter in SQL; derived ones filter after.
    const STORED = ['draft', 'issued', 'paid', 'partially_paid', 'cancelled', 'refunded'];
    if (status && STORED.includes(status)) where.status = status;

    const { rows, count } = await ClientInvoice.findAndCountAll({
        where,
        include: [{ association: 'plan', attributes: ['id', 'name'], required: false }],
        order: [['issue_date', 'DESC'], ['id', 'DESC']],
        offset: (p - 1) * l,
        limit: l,
    });

    let shaped = rows.map((r) => shapeInvoice(r));
    if (status && !STORED.includes(status)) shaped = shaped.filter((i) => i.status === status);

    /*
      The Payment Method column.

      ONE extra query for the whole page, not one per row: the list is at most
      100 invoices and this is an indexed `IN`. Doing it here rather than as an
      `include` keeps the count query above from having to join a hasMany.
    */
    if (shaped.length) {
        const payments = await ClientTransaction.findAll({
            where: {
                invoice_id: shaped.map((i) => i.id),
                type: 'payment',
                status: { [Op.ne]: 'failed' },
            },
            order: [['occurred_at', 'DESC'], ['id', 'DESC']],
            raw: true,
        });
        const byInvoice = new Map();
        // Ordered newest-first, so the FIRST one seen for an invoice is the
        // one that settled it.
        for (const tx of payments) {
            if (!byInvoice.has(tx.invoice_id)) byInvoice.set(tx.invoice_id, tx);
        }
        shaped = shaped.map((i) => ({ ...i, payment_method: shapeMethod(byInvoice.get(i.id)) }));
    }

    // The tiles count the WHOLE account, never the filtered page — a "Total
    // Invoices" that changes when you type in the search box is not a total.
    const all = await ClientInvoice.findAll({
        where: { website_client_id: clientId },
        attributes: ['status', 'total', 'amount_paid', 'amount_due', 'due_date'],
        raw: true,
    });

    const byStatus = {};
    let totalAmount = 0; let paidAmount = 0; let outstanding = 0;
    for (const inv of all) {
        const s = displayStatus(inv);
        byStatus[s] = (byStatus[s] || 0) + 1;
        totalAmount += Number(inv.total);
        paidAmount += Number(inv.amount_paid);
        outstanding += Number(inv.amount_due);
    }

    return {
        invoices: shaped,
        pagination: { page: p, limit: l, totalItems: count, totalPages: Math.ceil(count / l) },
        stats: {
            total_invoices: all.length,
            total_amount: round2(totalAmount),
            paid_amount: round2(paidAmount),
            outstanding_amount: round2(outstanding),
            by_status: byStatus,
        },
        payments_enabled: PAYMENTS_ENABLED,
        payments_reason: PAYMENTS_ENABLED ? null : PAYMENTS_DISABLED_REASON,
    };
};

/**
 * One invoice.
 *
 * Owner-scoped, so "not found" and "not yours" are deliberately the same
 * answer — distinguishing them would confirm that an invoice number exists on
 * somebody else's account.
 */
const getInvoice = async (clientId, invoiceId) => {
    const id = Number(invoiceId);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('Invoice not found.');

    const invoice = await ClientInvoice.findOne({
        where: { id, website_client_id: clientId },
        include: [
            { association: 'plan', attributes: ['id', 'name'], required: false },
            { association: 'items', required: false, separate: true, order: [['sort_order', 'ASC']] },
            { association: 'transactions', required: false, separate: true, order: [['occurred_at', 'ASC']] },
        ],
    });
    if (!invoice) throw ApiError.notFound('Invoice not found.');

    return {
        invoice: shapeInvoice(invoice, { withItems: true }),
        payments_enabled: PAYMENTS_ENABLED,
        payments_reason: PAYMENTS_ENABLED ? null : PAYMENTS_DISABLED_REASON,
    };
};

/**
 * Billing History — the money ledger MERGED with the subscription lifecycle log.
 *
 * The design's own table mixes them: "Payment for INV-…" and "Invoice for May"
 * beside "Subscription created". They are two tables because they are two kinds
 * of fact (see ClientTransaction's header); merging happens here, at read time.
 *
 * Sorted and paginated in JS over both sets. Safe because a client's billing
 * history is bounded by their own terms — tens of rows, not thousands — and a
 * UNION across two differently-shaped tables in SQL would be harder to read
 * than the thing it saves.
 */
const getBillingHistory = async (clientId, {
    type, search, from, to, status, page = 1, limit = 10,
} = {}) => {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 10));

    const [txs, events] = await Promise.all([
        ClientTransaction.findAll({
            where: { website_client_id: clientId },
            include: [{ association: 'invoice', attributes: ['id', 'invoice_number'], required: false }],
            order: [['occurred_at', 'DESC']],
        }),
        ClientSubscriptionEvent.findAll({
            where: { website_client_id: clientId },
            order: [['occurred_at', 'DESC']],
        }),
    ]);

    const rows = [
        ...txs.map((t) => {
            const j = t.toJSON();
            return {
                key: `tx-${j.id}`,
                occurred_at: j.occurred_at,
                description: j.description,
                type: j.type,
                amount: Number(j.amount),
                currency_code: j.currency_code,
                status: j.status,
                reference: j.reference,
                invoice_id: j.invoice_id,
                invoice_number: j.invoice?.invoice_number ?? null,
            };
        }),
        ...events.map((e) => {
            const j = e.toJSON();
            return {
                key: `ev-${j.id}`,
                occurred_at: j.occurred_at,
                description: j.description,
                // Lifecycle rows read as "Setup" in the design's Type column.
                type: 'setup',
                event_type: j.type,
                // NULL, not 0 — a plan change is not a zero-rupee transaction.
                amount: null,
                currency_code: j.currency_code,
                status: 'completed',
                reference: null,
                invoice_id: null,
                invoice_number: null,
            };
        }),
    ].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));

    /*
      The summary counts the WHOLE ledger, not the filtered page.

      A "Transaction Summary" rail that changed every time somebody typed in the
      search box would be reporting the search, not the account — and the design
      places it beside the filters as a stable fact about the account.
    */
    const summary = { all: rows.length, payment: 0, invoice: 0, refund: 0, setup: 0, failed: 0 };
    for (const r of rows) {
        if (summary[r.type] !== undefined) summary[r.type] += 1;
        if (r.status === 'failed') summary.failed += 1;
    }

    let filtered = rows;
    if (type && type !== 'all') filtered = filtered.filter((r) => r.type === type);
    if (status && status !== 'all') filtered = filtered.filter((r) => r.status === status);

    if (search) {
        // Description, invoice number and reference — the three things visible
        // in the row, so searching finds what the person can actually see.
        const q = String(search).trim().toLowerCase();
        if (q) {
            filtered = filtered.filter((r) =>
                [r.description, r.invoice_number, r.reference]
                    .some((v) => v && String(v).toLowerCase().includes(q)));
        }
    }

    /*
      Date range is INCLUSIVE of the `to` day.

      `to` arrives as a plain date (2026-08-29) which parses as that day's
      midnight, so a naive `<=` silently excludes everything that happened
      during the chosen final day — the most confusing possible off-by-one,
      because the row is visible in the list until you filter for it.
    */
    if (from) {
        const start = new Date(from);
        if (!Number.isNaN(start.getTime())) {
            filtered = filtered.filter((r) => new Date(r.occurred_at) >= start);
        }
    }
    if (to) {
        const end = new Date(to);
        if (!Number.isNaN(end.getTime())) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(to).trim())) end.setHours(23, 59, 59, 999);
            filtered = filtered.filter((r) => new Date(r.occurred_at) <= end);
        }
    }

    return {
        transactions: filtered.slice((p - 1) * l, p * l),
        pagination: {
            page: p,
            limit: l,
            totalItems: filtered.length,
            totalPages: Math.max(1, Math.ceil(filtered.length / l)),
        },
        summary,
        // What the filters actually matched, as distinct from the account total
        // above — the design prints "Showing 1 to 10 of 26".
        filtered_count: filtered.length,
        note: 'Payments appear here once online payment is enabled.',
    };
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Sales enquiries
 * ────────────────────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Store a Contact Sales submission.
 *
 * ⚠ There is no SMTP anywhere in this system, so nothing is emailed. The row is
 * stored and the screen says a person will follow up — the alternative is a
 * form that silently discards what somebody typed, which this codebase has
 * shipped before and which reads as working until you check.
 */
const createSalesEnquiry = async (clientId, body = {}) => {
    const name = String(body.full_name || '').trim();
    const email = String(body.work_email || '').trim();
    const message = String(body.message || '').trim();

    if (!name) throw ApiError.badRequest('Please enter your name.');
    if (!EMAIL_RE.test(email)) throw ApiError.badRequest('Please enter a valid work email.');
    if (!message) throw ApiError.badRequest('Please tell us about your requirements.');

    // Only what the enquiry needs to be scoped — see the note above about
    // selecting the whole row.
    const client = clientId
        ? await WebsiteClient.findByPk(clientId, { attributes: ['id', 'company_id'] })
        : null;

    const interests = Array.isArray(body.interests)
        ? body.interests.map((i) => String(i).slice(0, 80)).slice(0, 20)
        : null;

    const row = await ClientSalesEnquiry.create({
        website_client_id: clientId ?? null,
        company_id: client?.company_id ?? null,
        full_name: name.slice(0, 150),
        work_email: email.slice(0, 190),
        company_name: body.company_name ? String(body.company_name).slice(0, 190) : null,
        phone: body.phone ? String(body.phone).slice(0, 30) : null,
        events_per_year: body.events_per_year ? String(body.events_per_year).slice(0, 50) : null,
        interests,
        message: message.slice(0, 5000),
        preferred_time: body.preferred_time ? String(body.preferred_time).slice(0, 50) : null,
        status: 'new',
    });

    return {
        id: row.id,
        submitted_at: row.created_at,
        // Said plainly rather than "we have emailed our team", which would be
        // untrue — there is no mail transport.
        message: 'Thanks — your enquiry is saved and our team will get back to you.',
        delivery: 'stored',
    };
};

module.exports = {
    PAYMENTS_ENABLED,
    computeTotals,
    displayStatus,
    raiseInvoiceForTerm,
    recordPayment,
    listInvoices,
    getInvoice,
    getBillingHistory,
    createSalesEnquiry,
    nextInvoiceNumber,
    // Exported for the tests — the words and the figure must never disagree.
    amountInWords,
};
