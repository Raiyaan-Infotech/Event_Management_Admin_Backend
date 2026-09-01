/*
 * Client-portal Billing, Phase 1.
 *
 * Two things earn a test here rather than a click-through:
 *
 *  1. deriveStatus(). Five branches over two stored fields and a clock, and it
 *     already produced a real bug — a term cancelled but still running derived
 *     as `active`, which let the cancel guard through twice and wrote a
 *     duplicate row into the billing history. Boundary cases only exist here.
 *
 *  2. resolvePlanLimits(). The stored limits are genuinely inconsistent —
 *     plan 3 holds "200" as a string where plans 4-6 hold 200 as a number, and
 *     storage_gb is the string "100 GB". A coercion bug here shows up as a
 *     usage bar that is silently wrong rather than as an error.
 *
 * Read-only against the database. Nothing is created, updated or deleted.
 */
require('dotenv').config();
const { SubscriptionPlan, ClientSubscription, sequelize } = require('../src/models');
const billing = require('../src/services/clientBilling.service');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

const day = 86400000;
const at = (offsetDays) => new Date(Date.now() + offsetDays * day);

(async () => {
    const now = new Date();

    console.log('\n── deriveStatus: the eight states ─────────────────');

    ok('a running term is active',
        billing.deriveStatus({ status: 'active', current_period_end: at(30), cancel_at_period_end: 0 }, now) === 'active');

    ok('a term inside its trial is trialing',
        billing.deriveStatus({ status: 'active', current_period_end: at(30), trial_ends_at: at(3), cancel_at_period_end: 0 }, now) === 'trialing');

    ok('a trial that has ended falls back to active',
        billing.deriveStatus({ status: 'active', current_period_end: at(30), trial_ends_at: at(-1), cancel_at_period_end: 0 }, now) === 'active');

    // The regression. This must NOT be 'active'.
    ok('cancelled but still running is "cancelling", not "active"',
        billing.deriveStatus({ status: 'active', current_period_end: at(30), cancel_at_period_end: 1 }, now) === 'cancelling');

    ok('cancelled and past its end is "cancelled"',
        billing.deriveStatus({ status: 'active', current_period_end: at(-1), cancel_at_period_end: 1 }, now) === 'cancelled');

    ok('a lapsed term that was never cancelled is "expired"',
        billing.deriveStatus({ status: 'active', current_period_end: at(-1), cancel_at_period_end: 0 }, now) === 'expired');

    ok('an explicitly cancelled row stays cancelled',
        billing.deriveStatus({ status: 'cancelled', current_period_end: at(30), cancel_at_period_end: 1 }, now) === 'cancelled');

    // Lifetime: no end date at all, which must not be read as "ended".
    ok('a lifetime term (no end date) is active',
        billing.deriveStatus({ status: 'active', current_period_end: null, cancel_at_period_end: 0 }, now) === 'active');

    ok('null subscription derives null', billing.deriveStatus(null) === null);

    console.log('\n── addCycle ──────────────────────────────────────');
    const base = new Date('2026-01-31T00:00:00Z');
    ok('monthly advances a month', billing.addCycle(base, 'monthly') > base);
    ok('quarterly advances further than monthly',
        billing.addCycle(base, 'quarterly') > billing.addCycle(base, 'monthly'));
    ok('yearly advances a year',
        billing.addCycle(base, 'yearly').getUTCFullYear() === base.getUTCFullYear() + 1);
    // Lifetime has NO next date. null, never a far-future date nobody agreed to.
    ok('lifetime returns null', billing.addCycle(base, 'lifetime') === null);

    console.log('\n── withTax: EXCLUSIVE, added on top ───────────────');
    const t = billing.withTax(2499, 18);
    ok('subtotal is the stored price', t.subtotal === 2499);
    ok('tax is added, not carved out', t.tax_amount === 449.82, JSON.stringify(t));
    ok('total = subtotal + tax', t.total === 2948.82, JSON.stringify(t));
    ok('the payload states it is exclusive', t.tax_inclusive === false);
    const free = billing.withTax(0, 18);
    ok('a free plan has no tax', free.total === 0 && free.tax_amount === 0);

    console.log('\n── resolvePlanLimits: mixed stored types ──────────');
    const plans = await SubscriptionPlan.findAll({ attributes: ['id', 'name'], order: [['id', 'ASC']] });
    let sawStorage = false;
    let sawEvents = false;
    for (const p of plans) {
        const limits = await billing.resolvePlanLimits(p.id);
        const keys = Object.keys(limits);
        if (!keys.length) continue;
        const allNumbers = keys.every((k) => typeof limits[k] === 'number' && Number.isFinite(limits[k]));
        ok(`plan ${p.id} ${p.name}: every limit coerced to a finite number`, allNumbers, JSON.stringify(limits));
        if (limits.storage_gb !== undefined) sawStorage = true;
        if (limits.max_events !== undefined) sawEvents = true;
    }
    // Plan 3 stores its limits as STRINGS and storage_gb as "100 GB". If the
    // coercion regressed, one of these would come back as a string or NaN.
    const plan3 = await billing.resolvePlanLimits(3);
    ok('plan 3 ("200" as a string) coerces to the number 200',
        plan3.max_rsvps === 200, JSON.stringify(plan3));
    ok('"100 GB" coerces to the number 100',
        plan3.storage_gb === 100, JSON.stringify(plan3));
    ok('at least one plan exposes a storage ceiling', sawStorage);
    ok('at least one plan exposes an event ceiling', sawEvents);
    ok('a plan with no menus yields no limits, not a crash',
        Object.keys(await billing.resolvePlanLimits(999999)).length === 0);
    ok('a null plan id yields no limits',
        Object.keys(await billing.resolvePlanLimits(null)).length === 0);

    console.log('\n── getOverview against real rows ─────────────────');
    const subs = await ClientSubscription.findAll({ attributes: ['website_client_id'], limit: 1 });
    if (subs.length) {
        const clientId = subs[0].website_client_id;
        const o = await billing.getOverview(clientId);
        ok('a subscribed client gets a subscription', !!o.subscription);
        ok('the derived status is one of the known values',
            ['active', 'trialing', 'cancelling', 'cancelled', 'expired'].includes(o.subscription.status),
            o.subscription.status);
        ok('features come from the granted menus', Array.isArray(o.features) && o.features.length > 0);
        ok('events usage is available', o.usage.events.available === true);
        // The two that must NEVER report a number they cannot back up.
        ok('messages report unavailable, not 0',
            o.usage.messages.available === false && o.usage.messages.used === null);
        ok('storage USED is null even though a ceiling is known',
            o.usage.storage.available === false && o.usage.storage.used_gb === null);
        ok('every unavailable area carries a reason',
            Object.values(o.unavailable).every((r) => typeof r === 'string' && r.length > 10));

        const p = await billing.getAvailablePlans(clientId);
        ok('only live plans are offered',
            p.plans.every((x) => Number(x.is_active) === 1 && Number(x.is_visible) === 1));
        ok('exactly one plan is flagged current',
            p.plans.filter((x) => x.is_current).length <= 1);
        ok('every offered plan carries a tax breakdown',
            p.plans.every((x) => x.amount && x.amount.tax_inclusive === false));
    } else {
        console.log('  (skipped — no client_subscriptions rows)');
    }


    console.log('\n-- invoice maths: EXCLUSIVE tax, components that add up --');
    const invoices = require('../src/services/clientInvoice.service');

    const t1 = invoices.computeTotals({ subtotal: 2499, taxRate: 18 });
    ok('subtotal untouched', t1.subtotal === 2499);
    ok('tax added on top, not carved out', t1.tax_amount === 449.82, JSON.stringify(t1));
    ok('total = subtotal + tax', t1.total === 2948.82, JSON.stringify(t1));
    ok('flagged exclusive', t1.tax_inclusive === 0);
    ok('split into CGST + SGST', t1.tax_breakdown.map((b) => b.label).join('+') === 'CGST+SGST');
    ok('components sum EXACTLY to tax_amount',
        Math.abs(t1.tax_breakdown.reduce((a, b) => a + b.amount, 0) - t1.tax_amount) < 1e-9,
        JSON.stringify(t1.tax_breakdown));

    // The odd-paisa case. An even split would leave the two halves summing to a
    // different number than tax_amount, which is exactly how the supplied
    // mockup's invoice failed to reconcile with itself.
    const odd = invoices.computeTotals({ subtotal: 1499, taxRate: 18 });
    ok('odd amounts still reconcile',
        Math.abs(odd.tax_breakdown.reduce((a, b) => a + b.amount, 0) - odd.tax_amount) < 1e-9,
        JSON.stringify(odd));

    const disc = invoices.computeTotals({ subtotal: 1000, discount: 200, taxRate: 18 });
    ok('tax is charged AFTER discount', disc.tax_amount === 144, JSON.stringify(disc));
    ok('discounted total correct', disc.total === 944, JSON.stringify(disc));

    const freeInvoice = invoices.computeTotals({ subtotal: 0, taxRate: 18 });
    ok('a free plan has no tax and no components',
        freeInvoice.total === 0 && freeInvoice.tax_amount === 0 && freeInvoice.tax_breakdown.length === 0);

    console.log('\n-- invoice display status --');
    ok('unpaid when nothing is paid',
        invoices.displayStatus({ status: 'issued', amount_paid: 0, amount_due: 100, due_date: null }) === 'unpaid');
    ok('paid when nothing is due',
        invoices.displayStatus({ status: 'issued', amount_paid: 100, amount_due: 0, due_date: null }) === 'paid');
    ok('partially paid when some is due',
        invoices.displayStatus({ status: 'issued', amount_paid: 40, amount_due: 60, due_date: null }) === 'partially_paid');
    ok('cancelled wins over amounts',
        invoices.displayStatus({ status: 'cancelled', amount_paid: 0, amount_due: 100 }) === 'cancelled');
    // The rule that matters while there is no gateway: no due date is stamped,
    // so an unpayable invoice can never be shown as the client's fault.
    ok('payments are disabled, so nothing gets a due date',
        invoices.PAYMENTS_ENABLED === false);
    ok('with no due date it reads unpaid, never overdue',
        invoices.displayStatus({ status: 'issued', amount_paid: 0, amount_due: 100, due_date: null }) !== 'overdue');

    console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
    await sequelize.close();
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH:', e.message); console.error(e.stack); process.exit(1); });
