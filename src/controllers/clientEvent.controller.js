const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const clientEventService = require('../services/clientEvent.service');
const clientAnalyticsService = require('../services/clientAnalytics.service');

/**
 * Events, for the signed-in website client.
 *
 * Every handler reads `req.websiteClient.id` and passes it into the service as
 * the scope. No handler takes an owner id from the request — that is what stops
 * one client's event id from being readable by another.
 */

/** The dashboard's event grid. Paginated, tab-filtered, searchable. */
const list = asyncHandler(async (req, res) => {
    const { rows, pagination } = await clientEventService.listEvents(
        req.websiteClient.id,
        req.query
    );
    return ApiResponse.paginated(res, rows, pagination, 'Events retrieved');
});

/** The four dashboard tiles. */
const stats = asyncHandler(async (req, res) => {
    const data = await clientEventService.getDashboardStats(req.websiteClient.id);
    return ApiResponse.success(res, data, 'Dashboard stats retrieved');
});

/**
 * The Analytics screen.
 *
 * Real aggregates over the client's events. Guest, RSVP and messaging figures
 * are absent by design — there are no such tables — and the payload says so
 * with `guests_available` / `messaging_available` rather than returning zeroes
 * that would read as "nobody replied".
 */
const analytics = asyncHandler(async (req, res) => {
    // Two services, one payload. clientAnalytics owns the guest/message figures
    // the design leads with; clientEvent owns the event aggregates, because
    // three of those key off deriveStatus and that lives with the events.
    const [guestSide, eventSide] = await Promise.all([
        clientAnalyticsService.getAnalytics(req.websiteClient.id, req.query),
        clientEventService.getAnalytics(req.websiteClient.id, { months: 6 }),
    ]);

    return ApiResponse.success(res, {
        ...guestSide,
        event_totals: eventSide.totals,
        by_status: eventSide.by_status,
        by_category: eventSide.by_category,
        by_theme: eventSide.by_theme,
        top_menus: eventSide.top_menus,
        timeline: eventSide.timeline,
        recent_events: eventSide.recent_events,
        // Now that both tables exist, these are simply true.
        guests_available: true,
        messaging_available: true,
    }, 'Analytics retrieved');
});

const getById = asyncHandler(async (req, res) => {
    const event = await clientEventService.getEventById(req.websiteClient.id, req.params.id);
    if (!event) throw ApiError.notFound('Event not found.');
    return ApiResponse.success(res, { event }, 'Event retrieved');
});

/**
 * Create an event. The QR code is issued in the same transaction, so the
 * response always carries a `qr_token` — the wizard's success step can render
 * the code immediately without a second request.
 */
const create = asyncHandler(async (req, res) => {
    const event = await clientEventService.createEvent(req.websiteClient.id, req.body);
    return ApiResponse.created(res, { event }, 'Event created successfully');
});

const update = asyncHandler(async (req, res) => {
    const event = await clientEventService.updateEvent(
        req.websiteClient.id,
        req.params.id,
        req.body
    );
    if (!event) throw ApiError.notFound('Event not found.');
    return ApiResponse.success(res, { event }, 'Event updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    const ok = await clientEventService.deleteEvent(req.websiteClient.id, req.params.id);
    if (!ok) throw ApiError.notFound('Event not found.');
    return ApiResponse.success(res, null, 'Event deleted successfully');
});

/**
 * Turn a scanned QR string back into event details.
 *
 * POST rather than GET on purpose: the token is long and is the secret itself,
 * and a GET would write it into access logs, browser history and any proxy in
 * between.
 *
 * Deliberately behind the client session. The token is a capability — whoever
 * holds it can read the event — so an open endpoint would let anyone who
 * photographed an invitation pull the client id and plan id out of it. If
 * venue-side scanning by non-clients is needed later, that wants its own
 * endpoint returning a narrowed payload, not this one made public.
 */
const decodeQr = asyncHandler(async (req, res) => {
    const token = req.body?.token ?? req.body?.qr_token;
    if (!token) throw ApiError.badRequest('No QR token supplied.');

    const result = await clientEventService.resolveQrToken(String(token));
    // A wrong key, a truncated scan and a hand-edited code are indistinguishable
    // here and all mean the same thing to the caller.
    if (!result) throw ApiError.badRequest('This QR code is not valid.');

    return ApiResponse.success(res, result, 'QR code decoded');
});

module.exports = { list, stats, analytics, getById, create, update, remove, decodeQr };
