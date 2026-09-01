const {
    Sequelize,
    sequelize,
    WebsiteClient,
    SubscriptionPlan,
    SubscriptionPlanMenu,
    EventMenu,
    ClientSubscription,
    ClientSubscriptionEvent,
    Event,
    EventGuest,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
// One-way dependency: the invoice service knows nothing about this one, so
// there is no cycle. Terms are the only thing that raise invoices, and terms
// are managed here.
const invoiceService = require('./clientInvoice.service');

/**
 * Client-portal Billing — Phase 1.
 *
 * Covers the Overview and Change Plan screens. Invoices, payment methods,
 * transactions, add-ons and coupons are deliberately NOT here: none of them has
 * a table, and three of them need a payment gateway this project does not have.
 *
 * ── WHAT IS REAL ON THESE SCREENS, AND WHAT IS NOT ──────────────────────────
 * Written down because the supplied design shows all of it as though it were
 * equally backed, and it is not:
 *
 *   REAL   plan, price, billing cycle, term dates, next billing date,
 *          cancel / resume, scheduled plan change, events used, guests used,
 *          the plan's own event / guest / storage ceilings
 *   NOT    messages sent (the messaging module is paused by decision),
 *          storage USED (nothing measures it — the ceiling exists, the
 *          numerator does not), invoices, saved cards, add-ons, coupons
 *
 * Anything in the second list is reported as unavailable WITH A REASON rather
 * than as a zero. A 0 and an unbuilt feature look identical on a dashboard tile
 * and mean opposite things.
 *
 * ── ENTITLEMENT vs BILLING ──────────────────────────────────────────────────
 * `website_clients.subscription_plan_id` stays the entitlement pointer — it is
 * what ClientPlanGate, getEventOptions and templatesForPlan all read. This
 * service is the ONLY writer of both it and the subscription row, so the two
 * cannot drift into being two sources of truth.
 */

/** The plan columns the billing screens need. Not the whole row. */
const PLAN_ATTRS = [
    'id', 'name', 'plan_code', 'short_description', 'billing_cycle',
    'currency_code', 'price', 'trial_days', 'is_active', 'is_visible',
    'sort_order', 'plan_badge_id',
    'event_category_id', 'event_type_id', 'religion_id',
];

const SUBSCRIPTION_INCLUDE = [
    { association: 'plan', attributes: PLAN_ATTRS, required: false },
    { association: 'pendingPlan', attributes: PLAN_ATTRS, required: false },
];

/* ─────────────────────────────────────────────────────────────────────────────
 * Dates
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Advance a date by one billing cycle.
 *
 * Returns null for `lifetime`, which is the honest answer: there is no next
 * billing date, as distinct from one we failed to work out.
 */
const addCycle = (date, cycle) => {
    const d = new Date(date.getTime());
    switch (cycle) {
        case 'monthly': d.setMonth(d.getMonth() + 1); break;
        case 'quarterly': d.setMonth(d.getMonth() + 3); break;
        case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
        default: return null;
    }
    return d;
};

/**
 * The status to SHOW, which is not always the status stored.
 *
 * `cancelled` and `trialing` are decisions somebody made and are stored.
 * `expired` is a fact about the clock: the term ended and was not renewed.
 * Storing that would need a nightly job flipping rows and would leave a window
 * where the database disagrees with the calendar, so it is derived here — the
 * one place the decision is made.
 *
 * ── `cancelling` is DERIVED ONLY, and it had to exist ───────────────────────
 * A term that has been cancelled but has not yet ended is neither `active` nor
 * `cancelled`: access continues, and no renewal will follow. With no name for
 * it this function answered `active`, which let the cancel guard through a
 * second time and wrote a duplicate row into the billing history.
 *
 * It is deliberately NOT added to the stored ENUM. `cancel_at_period_end` plus
 * a date already record the fact; a fifth stored value would be a second way to
 * say the same thing, and the two could then disagree.
 */
const deriveStatus = (sub, now = new Date()) => {
    if (!sub) return null;
    if (sub.status === 'cancelled') return 'cancelled';

    const end = sub.current_period_end ? new Date(sub.current_period_end) : null;
    const cancelling = Number(sub.cancel_at_period_end) === 1;

    if (end && end <= now) return cancelling ? 'cancelled' : 'expired';

    // Still inside the paid term — somebody who has paid through June has June.
    if (cancelling) return 'cancelling';

    const trialEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null;
    if (trialEnd && trialEnd > now) return 'trialing';

    return sub.status === 'expired' ? 'active' : sub.status;
};

/** Cancelled outright, or cancelled and running out its term. */
const ENDING_STATUSES = new Set(['cancelled', 'cancelling']);

/* ─────────────────────────────────────────────────────────────────────────────
 * Plan limits
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A plan's ceilings, merged from the menus it grants.
 *
 * ⚠ The limits live on `subscription_plan_menus.limits_json`, i.e. per GRANTED
 * MENU, not per plan — that is where the admin's Step 4 wizard writes them. So
 * "the plan's max_events" means "the highest max_events among the menus this
 * plan grants". The MAXIMUM, not the minimum: a plan that grants two menus
 * which both cap events should not be capped by the stricter of two things it
 * paid for.
 *
 * ⚠ The stored values are not consistently typed. Plan 3 holds `"200"` as a
 * string where plans 4-6 hold `200` as a number, and `storage_gb` is the string
 * `"100 GB"`. Everything is coerced here rather than at the call sites, or the
 * first `>` comparison against a string silently does the wrong thing.
 */
const NUMERIC_LIMIT_KEYS = [
    'max_events', 'max_guests_per_event', 'max_rsvps',
    'max_photos', 'max_videos', 'storage_gb', 'rsvp_closing_days',
];

/** `"100 GB"` -> 100, `"200"` -> 200, `200` -> 200, junk -> null. */
const toNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const match = String(value).match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
};

const resolvePlanLimits = async (planId) => {
    if (!planId) return {};

    const rows = await SubscriptionPlanMenu.findAll({
        where: { plan_id: planId },
        attributes: ['menu_id', 'limits_json'],
        raw: true,
    });

    const merged = {};
    for (const row of rows) {
        let limits = row.limits_json;
        if (!limits) continue;
        // The column is JSON, but a row written as a string still parses back
        // as a string on some drivers. Tolerate both rather than assume.
        if (typeof limits === 'string') {
            try { limits = JSON.parse(limits); } catch { continue; }
        }
        if (typeof limits !== 'object') continue;

        for (const key of NUMERIC_LIMIT_KEYS) {
            const n = toNumber(limits[key]);
            if (n === null) continue;
            merged[key] = merged[key] === undefined ? n : Math.max(merged[key], n);
        }
    }
    return merged;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Reading the subscription, and healing it on the way past
 * ────────────────────────────────────────────────────────────────────────── */

const logEvent = async (payload, transaction) =>
    ClientSubscriptionEvent.create(
        { occurred_at: new Date(), ...payload },
        transaction ? { transaction } : undefined,
    );

/**
 * Keep the entitlement pointer in step with the billing record.
 *
 * Everything that gates what a client may DO reads
 * `website_clients.subscription_plan_id`, so a plan change that updated only
 * the subscription row would leave the portal offering the old plan's menus and
 * templates indefinitely.
 */
const syncEntitlement = async (clientId, planId, transaction) =>
    WebsiteClient.update(
        { subscription_plan_id: planId },
        { where: { id: clientId }, ...(transaction ? { transaction } : {}) },
    );

/**
 * Roll a term forward, and apply any change scheduled for its end.
 *
 * ⚠ Done LAZILY, on read, rather than by a cron job. This backend's only
 * scheduled work is the email worker, and Render sleeps a free instance — a job
 * that fires on a machine that is not running has not fired. A rollover that
 * happens when somebody looks at the page cannot be missed, and is idempotent
 * because it is driven entirely by comparing stored dates against now.
 *
 * Returns true when something was written, so the caller can re-read.
 */
const reconcile = async (sub) => {
    if (!sub) return false;
    const now = new Date();
    let changed = false;

    // 1. A scheduled plan change whose date has arrived.
    if (sub.pending_plan_id && sub.pending_effective_at && new Date(sub.pending_effective_at) <= now) {
        const nextPlan = await SubscriptionPlan.findByPk(sub.pending_plan_id, { attributes: PLAN_ATTRS });

        if (!nextPlan || Number(nextPlan.is_active) !== 1) {
            // The target was retired between scheduling and today. Drop the
            // schedule rather than moving somebody onto a dead plan, and say so.
            await logEvent({
                client_subscription_id: sub.id,
                website_client_id: sub.website_client_id,
                type: 'change_cancelled',
                from_plan_id: sub.subscription_plan_id,
                to_plan_id: sub.pending_plan_id,
                description: 'Scheduled plan change was dropped — the target plan is no longer available.',
                actor: 'system',
            });
            sub.pending_plan_id = null;
            sub.pending_effective_at = null;
            changed = true;
        } else {
            const fromPlanId = sub.subscription_plan_id;
            await logEvent({
                client_subscription_id: sub.id,
                website_client_id: sub.website_client_id,
                type: 'change_applied',
                from_plan_id: fromPlanId,
                to_plan_id: nextPlan.id,
                description: `Plan changed to ${nextPlan.name}`,
                amount: nextPlan.price,
                currency_code: nextPlan.currency_code,
                actor: 'system',
            });

            // The new term starts on the new plan's own terms, and the price is
            // re-snapshotted from it — that is what the client is now paying.
            sub.subscription_plan_id = nextPlan.id;
            sub.billing_cycle = nextPlan.billing_cycle;
            sub.price = nextPlan.price;
            sub.currency_code = nextPlan.currency_code || 'INR';
            sub.pending_plan_id = null;
            sub.pending_effective_at = null;
            sub.current_period_start = sub.current_period_end || now;
            sub.current_period_end = addCycle(new Date(sub.current_period_start), nextPlan.billing_cycle);
            sub.status = 'active';
            changed = true;

            await syncEntitlement(sub.website_client_id, nextPlan.id);

            // The new plan's first term is billed at the NEW price, which is why
            // the snapshot above is written before this runs.
            await sub.save();
            await invoiceService.raiseInvoiceForTerm(sub, {
                periodStart: sub.current_period_start,
                periodEnd: sub.current_period_end,
                issueDate: sub.current_period_start,
                planName: nextPlan.name,
            });
        }
    }

    // 2. Terms that have simply elapsed.
    //
    // Renewal is recorded, not charged: there is no gateway, so this rolls the
    // dates and logs a `renewed` row. When billing is wired, THIS is the point
    // that raises an invoice instead.
    if (sub.status !== 'cancelled' && Number(sub.cancel_at_period_end) !== 1) {
        let guard = 0;
        while (sub.current_period_end && new Date(sub.current_period_end) <= now && guard < 240) {
            const nextStart = new Date(sub.current_period_end);
            const nextEnd = addCycle(nextStart, sub.billing_cycle);
            if (!nextEnd) break;

            await logEvent({
                client_subscription_id: sub.id,
                website_client_id: sub.website_client_id,
                type: 'renewed',
                to_plan_id: sub.subscription_plan_id,
                description: 'Subscription term renewed',
                amount: sub.price,
                currency_code: sub.currency_code,
                actor: 'system',
                occurred_at: nextStart,
            });

            sub.current_period_start = nextStart;
            sub.current_period_end = nextEnd;
            changed = true;
            guard += 1;

            // Each new term raises its invoice. Idempotent on
            // (subscription, period_start), which matters because rollover is
            // lazy — two requests landing together would otherwise each raise
            // one for the same term.
            await invoiceService.raiseInvoiceForTerm(sub, {
                periodStart: nextStart,
                periodEnd: nextEnd,
                issueDate: nextStart,
            });
        }
    }

    // 3. A cancellation whose grace period has run out.
    if (
        Number(sub.cancel_at_period_end) === 1
        && sub.status !== 'cancelled'
        && sub.current_period_end
        && new Date(sub.current_period_end) <= now
    ) {
        await logEvent({
            client_subscription_id: sub.id,
            website_client_id: sub.website_client_id,
            type: 'expired',
            from_plan_id: sub.subscription_plan_id,
            description: 'Subscription ended after cancellation',
            actor: 'system',
        });
        sub.status = 'cancelled';
        changed = true;
        // The entitlement goes with it — a cancelled client keeps their data
        // and loses the ability to create against a plan they no longer hold.
        await syncEntitlement(sub.website_client_id, null);
    }

    if (changed) await sub.save();
    return changed;
};

/**
 * The client's current subscription, reconciled.
 *
 * Self-heals one legacy case: a client carrying `subscription_plan_id` with no
 * subscription row — which is every client who was assigned a plan from the
 * admin Clients screen before this module existed, and every one assigned
 * through it afterwards, since that screen writes only the pointer. Without
 * this, Billing would tell somebody plainly on a plan that they have none.
 */
const getCurrentSubscription = async (clientId) => {
    const client = await WebsiteClient.findByPk(clientId);
    if (!client) throw ApiError.notFound('Account not found.');

    let sub = await ClientSubscription.findOne({
        where: { website_client_id: clientId },
        include: SUBSCRIPTION_INCLUDE,
        order: [['created_at', 'DESC']],
    });

    if (!sub && client.subscription_plan_id) {
        const plan = await SubscriptionPlan.findByPk(client.subscription_plan_id, { attributes: PLAN_ATTRS });
        if (plan) {
            const started = client.created_at ? new Date(client.created_at) : new Date();
            let periodStart = new Date(started.getTime());
            let periodEnd = addCycle(periodStart, plan.billing_cycle);
            const now = new Date();
            let guard = 0;
            while (periodEnd && periodEnd <= now && guard < 600) {
                periodStart = periodEnd;
                periodEnd = addCycle(periodStart, plan.billing_cycle);
                guard += 1;
            }
            const trialEnds = Number(plan.trial_days) > 0
                ? new Date(started.getTime() + Number(plan.trial_days) * 86400000)
                : null;

            const created = await ClientSubscription.create({
                website_client_id: clientId,
                subscription_plan_id: plan.id,
                company_id: client.company_id ?? null,
                vendor_id: client.vendor_id ?? null,
                status: trialEnds && trialEnds > now ? 'trialing' : 'active',
                billing_cycle: plan.billing_cycle,
                price: plan.price,
                currency_code: plan.currency_code || 'INR',
                started_at: started,
                current_period_start: periodStart,
                current_period_end: periodEnd,
                trial_ends_at: trialEnds,
            });

            await logEvent({
                client_subscription_id: created.id,
                website_client_id: clientId,
                type: 'created',
                to_plan_id: plan.id,
                description: `Subscription created — ${plan.name} (${plan.billing_cycle})`,
                amount: plan.price,
                currency_code: plan.currency_code || 'INR',
                actor: 'system',
                occurred_at: started,
            });

            // The opening term gets its invoice too, or the very first thing a
            // client sees on the Invoices tab is an empty list for a plan they
            // are demonstrably on.
            await invoiceService.raiseInvoiceForTerm(created, {
                periodStart: created.current_period_start,
                periodEnd: created.current_period_end,
                issueDate: created.current_period_start,
                planName: plan.name,
            });

            sub = await ClientSubscription.findByPk(created.id, { include: SUBSCRIPTION_INCLUDE });
        }
    }

    if (sub && await reconcile(sub)) {
        sub = await ClientSubscription.findByPk(sub.id, { include: SUBSCRIPTION_INCLUDE });
    }

    return { client, subscription: sub };
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Usage
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * What the client has used, over the CURRENT BILLING PERIOD.
 *
 * The design labels this panel "Usage This Month". It is counted per BILLING
 * PERIOD instead, and labelled with the period's own dates, because that is the
 * window a plan ceiling actually applies to — on a yearly plan, a monthly count
 * against an annual allowance is a number that means nothing.
 *
 * `messages` and `storage_used` come back null WITH a reason. They are not
 * zeroes: the messaging module is paused by decision, and nothing anywhere
 * measures bytes stored per client. The ceiling for storage IS known, which is
 * exactly the trap — a limit with no measurement invites a progress bar that
 * looks precise and is invented.
 */
const getUsage = async (clientId, subscription) => {
    const periodStart = subscription?.current_period_start
        ? new Date(subscription.current_period_start)
        : null;
    const periodEnd = subscription?.current_period_end
        ? new Date(subscription.current_period_end)
        : null;

    const eventWhere = { website_client_id: clientId };
    if (periodStart) {
        eventWhere.created_at = periodEnd
            ? { [Op.gte]: periodStart, [Op.lt]: periodEnd }
            : { [Op.gte]: periodStart };
    }

    const events = await Event.count({ where: eventWhere });

    // Guests are counted in HEADS (party_size), which is what a caterer means
    // and what the guest module's own Total Guests tile reports. Scoped to the
    // client's events in this period, via a subquery rather than a per-event
    // loop — production is ~374ms a round trip.
    const guestRow = await EventGuest.findOne({
        attributes: [[Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('party_size')), 0), 'heads']],
        where: {
            event_id: {
                [Op.in]: Sequelize.literal(
                    `(SELECT id FROM events WHERE website_client_id = ${Number(clientId)} AND deleted_at IS NULL)`,
                ),
            },
        },
        raw: true,
    });

    const limits = await resolvePlanLimits(subscription?.subscription_plan_id);

    return {
        period_start: periodStart,
        period_end: periodEnd,
        events: {
            used: events,
            limit: limits.max_events ?? null,
            available: true,
        },
        guests: {
            used: Number(guestRow?.heads || 0),
            // max_guests_per_event is a PER-EVENT ceiling, so it is not a
            // denominator for a total. Reported separately rather than misused.
            limit: null,
            per_event_limit: limits.max_guests_per_event ?? null,
            available: true,
        },
        messages: {
            used: null,
            limit: null,
            available: false,
            reason: 'Messaging is paused — no messages have been sent from this account.',
        },
        storage: {
            used_gb: null,
            limit_gb: limits.storage_gb ?? null,
            available: false,
            reason: 'Storage usage is not measured yet.',
        },
        rsvps: {
            limit: limits.max_rsvps ?? null,
        },
    };
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Shaping
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The bullet list under a plan.
 *
 * Derived from the menus the plan actually GRANTS, because that is the only
 * per-plan feature information in the database that is true.
 *
 * ⚠ Deliberately NOT `plan_types.features`, which is the obvious-looking
 * source and is wrong twice over: it is Quill HTML of generic filler ("Some
 * Extra Feature Compared Then Bronze"), and several unrelated plans point at
 * the same plan_type — Basic Plan and Free Trial Plan both resolve to type 1,
 * so they would advertise identical features.
 */
const featuresForPlan = async (planId) => {
    if (!planId) return [];
    const rows = await SubscriptionPlanMenu.findAll({
        where: { plan_id: planId },
        attributes: ['menu_id', 'sort_order'],
        include: [{
            model: EventMenu,
            as: 'menu',
            attributes: ['id', 'name', 'menu_group'],
            required: true,
            where: { is_active: 1 },
        }],
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    return rows.map((r) => ({
        id: r.menu.id,
        label: r.menu.name,
        group: r.menu.menu_group || 'core',
    }));
};

/** Money, with the tax the stored price does NOT include. */
const withTax = (price, taxRate) => {
    const base = Number(price) || 0;
    const rate = Number(taxRate) || 0;
    const tax = Math.round(base * rate) / 100;
    return {
        subtotal: Number(base.toFixed(2)),
        tax_rate: rate,
        tax_amount: Number(tax.toFixed(2)),
        total: Number((base + tax).toFixed(2)),
        // Stated so no screen has to guess, and so the two mockups that
        // disagree about this cannot both be implemented.
        tax_inclusive: false,
    };
};

const shapeSubscription = (sub) => {
    if (!sub) return null;
    const plain = sub.toJSON();
    const status = deriveStatus(sub);

    return {
        id: plain.id,
        status,
        stored_status: plain.status,
        plan: plain.plan || null,
        billing_cycle: plain.billing_cycle,
        started_at: plain.started_at,
        current_period_start: plain.current_period_start,
        current_period_end: plain.current_period_end,
        // The renewal date IS the period end, unless the term was cancelled or
        // is a lifetime one — in which case there is no next billing date, and
        // null says that rather than a date that will never be charged.
        next_billing_date:
            status === 'cancelled' || Number(plain.cancel_at_period_end) === 1
                ? null
                : plain.current_period_end,
        trial_ends_at: plain.trial_ends_at,
        is_trialing: status === 'trialing',
        cancel_at_period_end: Number(plain.cancel_at_period_end) === 1,
        cancelled_at: plain.cancelled_at,
        cancellation_reason: plain.cancellation_reason,
        amount: withTax(plain.price, plain.tax_rate),
        currency_code: plain.currency_code,
        pending_change: plain.pending_plan_id
            ? {
                plan: plain.pendingPlan || null,
                effective_at: plain.pending_effective_at,
            }
            : null,
    };
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The parts of the supplied Billing design that have no data behind them.
 *
 * Shipped as part of the payload rather than hardcoded in the UI so that each
 * card can state its own reason, and so these unlock by deleting an entry here
 * when the tables land — nobody has to remember which screens to revisit.
 */
const UNAVAILABLE = {
    invoices: 'Invoices are not generated yet.',
    payment_methods: 'No payment provider is connected, so cards cannot be saved.',
    transactions: 'Transaction history begins when payments are enabled.',
    addons: 'Add-ons are not available yet.',
    coupons: 'Coupon codes are not available yet.',
    billing_address: 'No billing address is stored on your account yet.',
};

/** Everything the Billing > Overview screen renders. */
const getOverview = async (clientId) => {
    const { client, subscription } = await getCurrentSubscription(clientId);

    if (!subscription) {
        return {
            subscription: null,
            reason: client.subscription_plan_id
                ? 'Your subscription plan is no longer available. Please contact us.'
                : 'No subscription plan is assigned to your account yet. Please contact us.',
            features: [],
            usage: await getUsage(clientId, null),
            unavailable: UNAVAILABLE,
        };
    }

    const [features, usage] = await Promise.all([
        featuresForPlan(subscription.subscription_plan_id),
        getUsage(clientId, subscription),
    ]);

    return {
        subscription: shapeSubscription(subscription),
        reason: null,
        features,
        usage,
        unavailable: UNAVAILABLE,
    };
};

/** The Change Plan screen: what this client could move to, and what they are on. */
const getAvailablePlans = async (clientId) => {
    const { client, subscription } = await getCurrentSubscription(clientId);

    // Only live, visible plans. A client must never be offered a plan an admin
    // has deactivated or hidden.
    const plans = await SubscriptionPlan.findAll({
        where: {
            is_active: 1,
            is_visible: 1,
            ...(client.company_id ? { company_id: client.company_id } : {}),
        },
        attributes: PLAN_ATTRS,
        order: [['sort_order', 'ASC'], ['price', 'ASC'], ['id', 'ASC']],
    });

    const withFeatures = await Promise.all(
        plans.map(async (p) => ({
            ...p.toJSON(),
            amount: withTax(p.price, subscription?.tax_rate ?? 18),
            features: await featuresForPlan(p.id),
            is_current: subscription?.subscription_plan_id === p.id,
            is_pending: subscription?.pending_plan_id === p.id,
        })),
    );

    return {
        current_plan_id: subscription?.subscription_plan_id ?? null,
        subscription: shapeSubscription(subscription),
        plans: withFeatures,
        // The screen's own banner promises this, so the date comes from the
        // record rather than being written into the copy.
        change_effective_at: subscription?.current_period_end ?? null,
    };
};

/**
 * Schedule a plan change for the end of the current term.
 *
 * ⚠ SCHEDULED, never immediate, and that is not a limitation being hidden — it
 * is what the Change Plan screen states. An immediate upgrade would have to
 * charge the difference, and there is no gateway to charge it with; applying it
 * for free instead would hand out a paid plan on a button press.
 *
 * Choosing the plan already scheduled is idempotent. Choosing the CURRENT plan
 * cancels a pending change rather than erroring — it is the natural way to
 * express "actually, stay where I am".
 */
const changePlan = async (clientId, planId) => {
    const targetId = Number(planId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
        throw ApiError.badRequest('Please choose a plan.');
    }

    const { client, subscription } = await getCurrentSubscription(clientId);
    if (!subscription) {
        throw ApiError.badRequest(
            'There is no active subscription on this account to change. Please contact us.',
        );
    }

    /**
     * A subscription that is ending cannot also be scheduled to change plan:
     * both would land on the same date and contradict each other. Refused with
     * the way out named, rather than silently un-cancelling — reversing a
     * cancellation the client did not ask to reverse is a worse surprise than
     * an extra click.
     */
    const status = deriveStatus(subscription);
    if (ENDING_STATUSES.has(status)) {
        const endsOn = subscription.current_period_end
            ? new Date(subscription.current_period_end).toISOString().slice(0, 10)
            : null;
        throw ApiError.badRequest(
            endsOn
                ? `Your subscription is set to end on ${endsOn}. Resume it before changing plan.`
                : 'Your subscription has been cancelled. Resume it before changing plan.',
        );
    }

    const plan = await SubscriptionPlan.findByPk(targetId, { attributes: PLAN_ATTRS });
    if (!plan || Number(plan.is_active) !== 1 || Number(plan.is_visible) !== 1) {
        throw ApiError.badRequest('That plan is not available.');
    }
    // Scoped, so a crafted request cannot move an account onto another
    // company's plan. The FK only checks that the id exists.
    if (client.company_id && plan.company_id && plan.company_id !== client.company_id) {
        throw ApiError.badRequest('That plan is not available.');
    }

    if (subscription.subscription_plan_id === targetId) {
        if (subscription.pending_plan_id) {
            await logEvent({
                client_subscription_id: subscription.id,
                website_client_id: clientId,
                type: 'change_cancelled',
                from_plan_id: subscription.subscription_plan_id,
                to_plan_id: subscription.pending_plan_id,
                description: 'Scheduled plan change cancelled',
                actor: 'client',
            });
            subscription.pending_plan_id = null;
            subscription.pending_effective_at = null;
            await subscription.save();
        }
        return getAvailablePlans(clientId);
    }

    const effectiveAt = subscription.current_period_end || new Date();

    subscription.pending_plan_id = plan.id;
    subscription.pending_effective_at = effectiveAt;
    await subscription.save();

    await logEvent({
        client_subscription_id: subscription.id,
        website_client_id: clientId,
        type: 'change_scheduled',
        from_plan_id: subscription.subscription_plan_id,
        to_plan_id: plan.id,
        description: `Plan change to ${plan.name} scheduled`,
        amount: plan.price,
        currency_code: plan.currency_code,
        actor: 'client',
    });

    return getAvailablePlans(clientId);
};

/**
 * Cancel at the end of the current term.
 *
 * Access is kept until `current_period_end`, so this writes a flag rather than
 * tearing the entitlement away — somebody who has paid through June has June.
 * The entitlement is cleared by `reconcile` once that date passes.
 */
const cancelSubscription = async (clientId, { reason, comments } = {}) => {
    const { subscription } = await getCurrentSubscription(clientId);
    if (!subscription) throw ApiError.badRequest('There is no active subscription to cancel.');
    // Covers BOTH a term already ended and one cancelled but still running.
    // Testing only for 'cancelled' let a second cancellation through and wrote
    // a duplicate row into the billing history.
    if (ENDING_STATUSES.has(deriveStatus(subscription))) {
        throw ApiError.badRequest('This subscription is already cancelled.');
    }

    subscription.cancel_at_period_end = 1;
    subscription.cancelled_at = new Date();
    subscription.cancellation_reason = reason ? String(reason).slice(0, 150) : null;
    subscription.cancellation_comments = comments ? String(comments).slice(0, 300) : null;
    // A pending upgrade makes no sense on a subscription that is ending.
    subscription.pending_plan_id = null;
    subscription.pending_effective_at = null;
    await subscription.save();

    await logEvent({
        client_subscription_id: subscription.id,
        website_client_id: clientId,
        type: 'cancelled',
        from_plan_id: subscription.subscription_plan_id,
        description: reason
            ? `Subscription cancelled — ${String(reason).slice(0, 200)}`
            : 'Subscription cancelled',
        actor: 'client',
    });

    return getOverview(clientId);
};

/** Undo a cancellation, while the term is still running. */
const resumeSubscription = async (clientId) => {
    const { subscription } = await getCurrentSubscription(clientId);
    if (!subscription) throw ApiError.badRequest('There is no subscription to resume.');
    if (!ENDING_STATUSES.has(deriveStatus(subscription))) {
        throw ApiError.badRequest('This subscription is not cancelled.');
    }
    // Once the term has actually ended there is nothing to resume — restarting
    // it would be a new purchase, at a price nobody has agreed to.
    if (subscription.current_period_end && new Date(subscription.current_period_end) <= new Date()) {
        throw ApiError.badRequest(
            'This subscription has already ended. Please choose a plan to start a new one.',
        );
    }

    subscription.cancel_at_period_end = 0;
    subscription.cancelled_at = null;
    subscription.cancellation_reason = null;
    subscription.cancellation_comments = null;
    subscription.status = 'active';
    await subscription.save();
    await syncEntitlement(clientId, subscription.subscription_plan_id);

    await logEvent({
        client_subscription_id: subscription.id,
        website_client_id: clientId,
        type: 'resumed',
        to_plan_id: subscription.subscription_plan_id,
        description: 'Subscription resumed',
        actor: 'client',
    });

    return getOverview(clientId);
};

/*
 * Billing history lives in `clientInvoice.service.getBillingHistory`.
 *
 * It was here, reading subscription events only. The design's own table mixes
 * lifecycle rows ("Subscription created") with money rows ("Payment for
 * INV-..."), so two endpoints each serving half were a second source of truth
 * waiting to disagree. The merged one replaced it.
 */

module.exports = {
    getOverview,
    getAvailablePlans,
    changePlan,
    cancelSubscription,
    resumeSubscription,
    // Exported for tests and for the admin side, which needs the same
    // definitions rather than a second copy of them.
    deriveStatus,
    resolvePlanLimits,
    // Exported so the invoice detail can report usage for THAT invoice's period
    // without clientInvoice.service requiring this one — that direction is
    // already taken (line 18) and requiring back would be a cycle.
    getUsage,
    addCycle,
    withTax,
};
