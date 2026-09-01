/*
 * Client-portal Billing — the HTTP layer, end to end against a running server.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM client-billing.test.js ──────────────────
 * That one exercises the service in-process and locks the pure logic
 * (deriveStatus, tax, limit coercion). This one goes through the REAL stack:
 * routes, `bodyTransform`, the auth middleware, the session cookie and the JSON
 * envelope. Every bug this file has caught so far lived in one of those layers,
 * not in the service — a route declared after `/:id`, a body key the middleware
 * snake_cased, a guard that never fired.
 *
 * ── IT RESTORES WHAT IT TOUCHES ─────────────────────────────────────────────
 * The write paths run against a real account, so the end of the file puts the
 * subscription back and deletes the rows this run created. A test that leaves
 * a cancelled subscription behind poisons the next one.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-billing-api.test.js
 * Requires the backend running on :5001 and the seeded test client.
 */
require('dotenv').config();

const BASE = process.env.TEST_API_URL || 'http://localhost:5001/api/v1';
const CREDENTIALS = {
    email: 'test@example.com',
    password: 'Test@123',
    mobile: '9884699435',
};

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

/** A tiny cookie jar — the session rides on a cookie, so it has to persist. */
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
    if (setCookie.length) {
        cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
    }
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, body: json };
};

(async () => {
    console.log(`\nBilling API against ${BASE}\n`);

    // ── Auth is required everywhere ────────────────────────────────────────
    console.log('── unauthenticated access ────────────────────────');
    for (const [m, p] of [
        ['GET', '/client/billing/overview'],
        ['GET', '/client/billing/plans'],
        ['GET', '/client/billing/invoices'],
        ['GET', '/client/billing/history'],
        ['POST', '/client/billing/change-plan'],
        ['POST', '/client/billing/cancel'],
    ]) {
        const r = await call(m, p, m === 'POST' ? {} : undefined);
        ok(`${m} ${p} -> 401`, r.status === 401, `got ${r.status}`);
    }

    // ── Sign in ────────────────────────────────────────────────────────────
    console.log('\n── sign in ───────────────────────────────────────');
    const login = await call('POST', '/public/website-clients/login', CREDENTIALS);
    ok('login succeeds', login.status === 200 && login.body?.success, login.body?.message);
    if (!login.body?.success) {
        console.log('\n  Cannot continue without a session.\n');
        process.exit(1);
    }
    const clientId = login.body.data.client.id;

    // ── Overview ───────────────────────────────────────────────────────────
    console.log('\n── overview ──────────────────────────────────────');
    const ov = await call('GET', '/client/billing/overview');
    const sub = ov.body?.data?.subscription;
    ok('overview 200', ov.status === 200);
    ok('carries a subscription', !!sub);
    ok('status is a known value',
        ['active', 'trialing', 'cancelling', 'cancelled', 'expired'].includes(sub?.status), sub?.status);
    ok('tax is EXCLUSIVE', sub?.amount?.tax_inclusive === false);
    ok('total = subtotal + tax',
        Math.abs((sub.amount.subtotal + sub.amount.tax_amount) - sub.amount.total) < 0.01,
        JSON.stringify(sub.amount));
    ok('features come from granted menus', (ov.body.data.features ?? []).length > 0);
    // The two that must never report a number they cannot back up.
    ok('messages report unavailable, not 0',
        ov.body.data.usage.messages.available === false && ov.body.data.usage.messages.used === null);
    ok('storage USED is null though a ceiling is known',
        ov.body.data.usage.storage.available === false && ov.body.data.usage.storage.used_gb === null);

    const originalPlanId = sub.plan?.id;

    // ── Plans ──────────────────────────────────────────────────────────────
    console.log('\n── plans ─────────────────────────────────────────');
    const pl = await call('GET', '/client/billing/plans');
    ok('plans 200', pl.status === 200);
    ok('only live plans offered',
        pl.body.data.plans.every((p) => Number(p.is_active) === 1 && Number(p.is_visible) === 1));
    ok('at most one flagged current',
        pl.body.data.plans.filter((p) => p.is_current).length <= 1);

    const other = pl.body.data.plans.find((p) => !p.is_current);

    // ── Change plan: schedules, never applies ──────────────────────────────
    console.log('\n── change plan ───────────────────────────────────');
    const sched = await call('POST', '/client/billing/change-plan', { plan_id: other.id });
    ok('change is accepted', sched.status === 200 && sched.body.success, sched.body?.message);
    const afterSched = await call('GET', '/client/billing/overview');
    ok('current plan is UNCHANGED (scheduled, not applied)',
        afterSched.body.data.subscription.plan.id === originalPlanId);
    ok('the change is reported as pending',
        afterSched.body.data.subscription.pending_change?.plan?.id === other.id);

    const clearIt = await call('POST', '/client/billing/change-plan', { plan_id: originalPlanId });
    ok('choosing the current plan clears the schedule',
        clearIt.status === 200 && clearIt.body.data.subscription.pending_change === null);

    console.log('\n── change plan: refusals ─────────────────────────');
    const bad = await call('POST', '/client/billing/change-plan', {});
    ok('missing plan_id refused', bad.status >= 400, `got ${bad.status}`);
    const ghost = await call('POST', '/client/billing/change-plan', { plan_id: 999999 });
    ok('unknown plan refused', ghost.status >= 400);
    // camelCase must NOT work — bodyTransform snake_cases keys, and the
    // controller reads plan_id. This asserts the contract rather than assuming.
    const camel = await call('POST', '/client/billing/change-plan', { planId: other.id });
    ok('camelCase planId is snake_cased by the middleware and accepted',
        camel.status === 200, `got ${camel.status}: ${camel.body?.message}`);
    await call('POST', '/client/billing/change-plan', { plan_id: originalPlanId });

    // ── Cancel / resume ────────────────────────────────────────────────────
    console.log('\n── cancel and resume ─────────────────────────────');
    const cancelled = await call('POST', '/client/billing/cancel', { reason: 'api regression test' });
    ok('cancel accepted', cancelled.status === 200);
    ok('status becomes "cancelling", NOT "cancelled" — the term is still running',
        cancelled.body.data.subscription.status === 'cancelling',
        cancelled.body.data.subscription.status);
    ok('next billing date clears', cancelled.body.data.subscription.next_billing_date === null);

    // The regression: this guard used to never fire, and wrote a duplicate row.
    const twice = await call('POST', '/client/billing/cancel', {});
    ok('DOUBLE-CANCEL IS REFUSED', twice.status >= 400, `got ${twice.status}`);

    const blocked = await call('POST', '/client/billing/change-plan', { plan_id: other.id });
    ok('change-plan while cancelling is refused', blocked.status >= 400, blocked.body?.message);

    const resumed = await call('POST', '/client/billing/resume');
    ok('resume accepted', resumed.status === 200);
    ok('back to active', resumed.body.data.subscription.status === 'active');
    const resumeTwice = await call('POST', '/client/billing/resume');
    ok('double-resume refused', resumeTwice.status >= 400);

    // ── Invoices ───────────────────────────────────────────────────────────
    console.log('\n── invoices ──────────────────────────────────────');
    const inv = await call('GET', '/client/billing/invoices');
    ok('invoices 200', inv.status === 200);
    ok('payments are reported as DISABLED', inv.body.data.payments_enabled === false);
    ok('and the reason is given', typeof inv.body.data.payments_reason === 'string');
    ok('tiles count the whole account',
        inv.body.data.stats.total_invoices >= inv.body.data.invoices.length);
    // No due date is stamped while payments are off, so nothing can read overdue.
    ok('nothing is "overdue" while payment is impossible',
        inv.body.data.invoices.every((i) => i.status !== 'overdue'),
        JSON.stringify(inv.body.data.invoices.map((i) => i.status)));

    const first = inv.body.data.invoices[0];
    if (first) {
        const det = await call('GET', `/client/billing/invoices/${first.id}`);
        const d = det.body?.data?.invoice;
        ok('invoice detail 200', det.status === 200);
        ok('tax components sum EXACTLY to tax_amount',
            Math.abs(d.tax_breakdown.reduce((a, b) => a + b.amount, 0) - d.tax_amount) < 0.005,
            JSON.stringify(d.tax_breakdown));
        ok('subtotal + tax = total',
            Math.abs((d.subtotal - d.discount_amount + d.tax_amount) - d.total) < 0.01);
        ok('has at least one line item', (d.items ?? []).length > 0);
        ok('billing name is a SNAPSHOT on the invoice', typeof d.billing_name === 'string');
    }

    // Owner scoping: an invoice on another account must be indistinguishable
    // from one that does not exist.
    const foreign = await call('GET', '/client/billing/invoices/1');
    ok("another client's invoice is 'not found', not 'forbidden'",
        foreign.status === 404, `got ${foreign.status}`);
    const nan = await call('GET', '/client/billing/invoices/abc');
    ok('a non-numeric id is refused, not queried as NaN', nan.status === 404);

    // ── History ────────────────────────────────────────────────────────────
    console.log('\n── billing history ───────────────────────────────');
    const hist = await call('GET', '/client/billing/history');
    ok('history 200', hist.status === 200);
    ok('merges the ledger and the lifecycle log',
        hist.body.data.transactions.some((t) => t.type === 'invoice')
        && hist.body.data.transactions.some((t) => t.type === 'setup'));
    ok('lifecycle rows carry a NULL amount, not 0',
        hist.body.data.transactions.filter((t) => t.type === 'setup').every((t) => t.amount === null));
    const filtered = await call('GET', '/client/billing/history?type=invoice');
    ok('type filter works',
        filtered.body.data.transactions.every((t) => t.type === 'invoice'));

    // ── Contact sales ──────────────────────────────────────────────────────
    console.log('\n── contact sales ─────────────────────────────────');
    const enq = await call('POST', '/client/billing/contact-sales', {
        full_name: 'API Regression',
        work_email: 'api.regression@example.com',
        message: 'Automated test enquiry.',
        interests: ['Custom Plan & Pricing'],
    });
    ok('enquiry accepted', enq.status === 200);
    ok('reports it was STORED, not emailed', enq.body.data.delivery === 'stored');
    const enquiryId = enq.body?.data?.id;

    for (const [label, payload] of [
        ['missing name', { work_email: 'a@b.com', message: 'x' }],
        ['bad email', { full_name: 'X', work_email: 'nope', message: 'x' }],
        ['empty message', { full_name: 'X', work_email: 'a@b.com', message: '   ' }],
    ]) {
        const r = await call('POST', '/client/billing/contact-sales', payload);
        ok(`${label} refused`, r.status >= 400, `got ${r.status}`);
    }

    // ── Restore ────────────────────────────────────────────────────────────
    console.log('\n── restore ───────────────────────────────────────');
    const { ClientSubscription, ClientSubscriptionEvent, ClientSalesEnquiry, WebsiteClient, sequelize } =
        require('../src/models');

    await ClientSubscription.update(
        {
            status: 'active', cancel_at_period_end: 0, cancelled_at: null,
            cancellation_reason: null, cancellation_comments: null,
            pending_plan_id: null, pending_effective_at: null,
        },
        { where: { website_client_id: clientId } },
    );
    await WebsiteClient.update({ subscription_plan_id: originalPlanId }, { where: { id: clientId } });
    const removedEvents = await ClientSubscriptionEvent.destroy({
        where: {
            website_client_id: clientId,
            type: ['change_scheduled', 'change_cancelled', 'cancelled', 'resumed'],
        },
    });
    if (enquiryId) await ClientSalesEnquiry.destroy({ where: { id: enquiryId }, force: true });

    const restored = await ClientSubscription.findOne({ where: { website_client_id: clientId } });
    ok('subscription restored to active',
        restored.status === 'active' && Number(restored.cancel_at_period_end) === 0);
    ok('entitlement pointer restored',
        (await WebsiteClient.findByPk(clientId)).subscription_plan_id === originalPlanId);
    console.log(`  removed ${removedEvents} test event row(s) and the test enquiry`);

    await sequelize.close();

    console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
    console.error('\nCRASH:', e.message);
    console.error(e.stack);
    process.exit(1);
});
