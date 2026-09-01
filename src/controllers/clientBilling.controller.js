const { asyncHandler } = require('../utils/helpers');
const paymentMethodService = require('../services/clientPaymentMethod.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
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

    /*
      The design's "Usage Summary (12 May – 11 Jun)" panel.

      Composed HERE rather than inside the invoice service, because usage lives
      in clientBilling.service and that module already requires this one's
      service — requiring back would be a cycle.

      ⚠ It is counted for THIS INVOICE'S period, not the current one. An invoice
      is a record of a past term; showing today's numbers on last month's
      invoice would be a different fact wearing the same label.
    */
    const inv = data.invoice;
    const usage = await billingService.getUsage(req.websiteClient.id, {
        current_period_start: inv.period_start,
        current_period_end: inv.period_end,
    });

    return ApiResponse.success(res, { ...data, usage }, 'Invoice retrieved');
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
        status: req.query.status,
        search: req.query.search,
        from: req.query.from,
        to: req.query.to,
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

/* ── Payment methods ─────────────────────────────────────────────────────── */

/**
 * The client's saved cards, plus whether a provider is connected at all.
 *
 * ⚠ The gateway TOKEN is never in this payload — only brand, last four and
 * expiry, which cannot be used to charge anything. See the service header.
 */
const listPaymentMethods = asyncHandler(async (req, res) => {
    const data = await paymentMethodService.listPaymentMethods(req.websiteClient);
    return ApiResponse.success(res, data, 'Payment methods retrieved');
});

/**
 * Save a TOKENISED card.
 *
 * ⚠ The body must carry the provider's token, never card details. The service
 * refuses a card-shaped body outright, so a form rewired to post the number
 * fails loudly rather than quietly storing it.
 */
const addPaymentMethod = asyncHandler(async (req, res) => {
    const method = await paymentMethodService.addPaymentMethod(req.websiteClient, req.body);
    // The token is deliberately absent from this log line as well.
    logger.logRequest(req, `Client saved a payment method: ${req.websiteClient.id} (${method.label})`);
    return ApiResponse.success(res, { method }, 'Payment method saved');
});

const setDefaultPaymentMethod = asyncHandler(async (req, res) => {
    const data = await paymentMethodService.setDefaultPaymentMethod(req.websiteClient, req.params.id);
    logger.logRequest(req, `Client changed default payment method: ${req.websiteClient.id}`);
    return ApiResponse.success(res, data, 'Default payment method updated');
});

const removePaymentMethod = asyncHandler(async (req, res) => {
    const data = await paymentMethodService.removePaymentMethod(req.websiteClient, req.params.id);
    logger.logRequest(req, `Client removed a payment method: ${req.websiteClient.id}`);
    return ApiResponse.success(res, data, 'Payment method removed');
});

module.exports = {
    listPaymentMethods, addPaymentMethod, setDefaultPaymentMethod, removePaymentMethod,
    overview, plans, changePlan, cancel, resume,
    listInvoices, getInvoice, history, contactSales,
};
