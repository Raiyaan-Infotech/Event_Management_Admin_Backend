const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const billingService = require('../services/clientBilling.service');
const invoiceService = require('../services/clientInvoice.service');

/**
 * Client-portal Billing.
 *
 * ── NO ID PARAMETER IDENTIFIES AN ACCOUNT ───────────────────────────────────
 * Every handler acts on `req.websiteClient.id`, set by
 * `isWebsiteClientAuthenticated`. The only `:id` here is an invoice's, and that
 * lookup is owner-scoped in the service — "not found" and "not yours" are
 * deliberately the same answer, or the response would confirm that an invoice
 * number exists on somebody else's account.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 * No checkout, no payment-method and no "pay this invoice" route. Those screens
 * exist in the design and there is no payment provider behind them; shipping
 * them would mean a Pay button that takes no money and a receipt for a payment
 * that never happened. Every payload carries `payments_enabled: false` and the
 * reason, so the UI states it rather than inventing a disabled-looking control.
 *
 * `recordPayment` exists in the service and is reachable from NO route here —
 * it is the seam a gateway webhook plugs into. Exposing it would let a client
 * mark their own invoice paid.
 */

/* ── Subscription ─────────────────────────────────────────────────────────── */

const overview = asyncHandler(async (req, res) => {
    const data = await billingService.getOverview(req.websiteClient.id);
    return ApiResponse.success(res, data, 'Billing overview retrieved');
});

const plans = asyncHandler(async (req, res) => {
    const data = await billingService.getAvailablePlans(req.websiteClient.id);
    return ApiResponse.success(res, data, 'Plans retrieved');
});

/** `bodyTransform` snake_cases incoming keys, so this reads `plan_id`. */
const changePlan = asyncHandler(async (req, res) => {
    const data = await billingService.changePlan(req.websiteClient.id, req.body?.plan_id);
    return ApiResponse.success(res, data, 'Plan change scheduled');
});

const cancel = asyncHandler(async (req, res) => {
    const data = await billingService.cancelSubscription(req.websiteClient.id, {
        reason: req.body?.reason,
        comments: req.body?.comments,
    });
    return ApiResponse.success(res, data, 'Subscription cancelled');
});

const resume = asyncHandler(async (req, res) => {
    const data = await billingService.resumeSubscription(req.websiteClient.id);
    return ApiResponse.success(res, data, 'Subscription resumed');
});

/* ── Invoices ─────────────────────────────────────────────────────────────── */

const listInvoices = asyncHandler(async (req, res) => {
    const data = await invoiceService.listInvoices(req.websiteClient.id, {
        status: req.query.status,
        search: req.query.search,
        from: req.query.from,
        to: req.query.to,
        page: req.query.page,
        limit: req.query.limit,
    });
    return ApiResponse.success(res, data, 'Invoices retrieved');
});

const getInvoice = asyncHandler(async (req, res) => {
    const data = await invoiceService.getInvoice(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, data, 'Invoice retrieved');
});

/**
 * Billing History — the money ledger merged with the subscription lifecycle log.
 *
 * Replaces the subscription-events-only version: the design's own table mixes
 * both, and having two endpoints that each showed half was a second source of
 * truth waiting to disagree.
 */
const history = asyncHandler(async (req, res) => {
    const data = await invoiceService.getBillingHistory(req.websiteClient.id, {
        type: req.query.type,
        page: req.query.page,
        limit: req.query.limit,
    });
    return ApiResponse.success(res, data, 'Billing history retrieved');
});

/* ── Sales ────────────────────────────────────────────────────────────────── */

/**
 * Contact Sales.
 *
 * ⚠ STORED, not emailed — there is no SMTP anywhere in this system. The
 * response says so via `delivery: 'stored'` so the screen can promise a
 * follow-up rather than implying a message just went out.
 */
const contactSales = asyncHandler(async (req, res) => {
    const data = await invoiceService.createSalesEnquiry(req.websiteClient.id, req.body || {});
    return ApiResponse.success(res, data, 'Enquiry received');
});

module.exports = {
    overview, plans, changePlan, cancel, resume,
    listInvoices, getInvoice, history, contactSales,
};
