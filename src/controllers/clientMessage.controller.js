const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const messageService = require('../services/clientMessage.service');
const notificationService = require('../services/clientNotification.service');

/**
 * Guest messaging and the notification feed.
 *
 * Both are strictly client-scoped: every service call takes `req.websiteClient`
 * and every lookup is filtered by it, so "not found" and "not yours" are the
 * same answer — distinguishing them would confirm that somebody else's campaign
 * exists.
 *
 * ⚠ There is NO route that creates a notification. The feed is written only by
 * other services through `notify()`; a client who could post to their own feed
 * could forge "Payment Successful".
 */

/* ── Messages ────────────────────────────────────────────────────────────── */

const composer = asyncHandler(async (req, res) => {
    const data = await messageService.getComposer(req.websiteClient, { eventId: req.query.event_id });
    return ApiResponse.success(res, data, 'Composer loaded');
});

const preview = asyncHandler(async (req, res) => {
    const data = await messageService.previewAudience(req.websiteClient, req.body);
    return ApiResponse.success(res, data, 'Audience resolved');
});

const send = asyncHandler(async (req, res) => {
    const data = await messageService.send(req.websiteClient, req.body);
    logger.logRequest(
        req,
        `Client ${req.websiteClient.id} recorded a ${data.campaign.channel} campaign `
        + `to ${data.recipients} guests (delivered: ${data.delivery.attempted})`,
    );
    /*
      The message names what really happened. It does NOT say "sent" while no
      provider is connected — the client reads this line and decides whether to
      go and check an inbox.
    */
    return ApiResponse.success(
        res,
        data,
        data.delivery.attempted
            ? `Message sent to ${data.recipients} guests`
            : `Message recorded for ${data.recipients} guests — delivery is not enabled yet`,
    );
});

const sendTest = asyncHandler(async (req, res) => {
    const data = await messageService.sendTest(req.websiteClient, req.body);
    return ApiResponse.success(res, data, data.sent ? 'Test sent' : 'Test could not be delivered');
});

const list = asyncHandler(async (req, res) => {
    const data = await messageService.listCampaigns(req.websiteClient, {
        channel: req.query.channel,
        status: req.query.status,
        eventId: req.query.event_id,
        search: req.query.search,
        from: req.query.from,
        to: req.query.to,
        page: req.query.page,
        limit: req.query.limit,
    });
    return ApiResponse.success(res, data, 'Messages retrieved');
});

const getById = asyncHandler(async (req, res) => {
    const data = await messageService.getCampaign(req.websiteClient, req.params.id);
    return ApiResponse.success(res, data, 'Message retrieved');
});

/* ── Notifications ───────────────────────────────────────────────────────── */

const listNotifications = asyncHandler(async (req, res) => {
    const data = await notificationService.list(req.websiteClient.id, {
        category: req.query.category,
        unread: req.query.unread,
        search: req.query.search,
        page: req.query.page,
        limit: req.query.limit,
    });
    return ApiResponse.success(res, data, 'Notifications retrieved');
});

/** The badge on its own — one indexed COUNT, called on every page load. */
const notificationCount = asyncHandler(async (req, res) => {
    const unread = await notificationService.unreadCount(req.websiteClient.id);
    return ApiResponse.success(res, { unread }, 'Unread count retrieved');
});

const markRead = asyncHandler(async (req, res) => {
    // `read: false` is honoured, so "mark as unread" is a real action rather
    // than a one-way door.
    const read = req.body?.read !== false;
    const data = await notificationService.markRead(req.websiteClient.id, req.params.id, read);
    return ApiResponse.success(res, { notification: data }, read ? 'Marked as read' : 'Marked as unread');
});

const markAllRead = asyncHandler(async (req, res) => {
    /*
      Scoped to the tab the client is looking at. "Mark all as read" pressed on
      the RSVP tab must not silently clear the System tab they have not seen.
    */
    const data = await notificationService.markAllRead(req.websiteClient.id, {
        category: req.body?.category || req.query.category,
    });
    return ApiResponse.success(res, data, `${data.marked} marked as read`);
});

const archive = asyncHandler(async (req, res) => {
    const data = await notificationService.archive(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, data, 'Notification archived');
});

module.exports = {
    composer, preview, send, sendTest, list, getById,
    listNotifications, notificationCount, markRead, markAllRead, archive,
};
