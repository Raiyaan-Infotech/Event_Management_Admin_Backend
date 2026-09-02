const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const rsvpService = require('../services/clientRsvp.service');

/**
 * RSVPs.
 *
 * Every handler takes `req.websiteClient` and every lookup is filtered by it,
 * so "not found" and "not yours" are the same answer — distinguishing them
 * would confirm that a guest exists on somebody else's account.
 *
 * ⚠ There is no `remove`. Clearing a response is `resetResponse`, and deleting
 * the PERSON is `DELETE /client/guests/:id`, which already exists. Two verbs
 * for two different acts, so a destructive button cannot be wired to the wrong
 * one by reading the route name.
 */

const list = asyncHandler(async (req, res) => {
    const data = await rsvpService.list(req.websiteClient.id, {
        event_id: req.query.event_id,
        group_id: req.query.group_id,
        status: req.query.status,
        search: req.query.search,
        from: req.query.from,
        to: req.query.to,
        page: req.query.page,
        limit: req.query.limit,
    });
    return ApiResponse.success(res, data, 'RSVPs retrieved');
});

const stats = asyncHandler(async (req, res) => {
    const data = await rsvpService.getStats(req.websiteClient.id, {
        event_id: req.query.event_id,
        group_id: req.query.group_id,
        search: req.query.search,
        from: req.query.from,
        to: req.query.to,
    });
    return ApiResponse.success(res, data, 'RSVP stats retrieved');
});

/**
 * The rows an export would contain, under the same filters as the list.
 *
 * Data, not a file — the CSV is built in the browser, as the invoice export is.
 * There is no spreadsheet library, no PDF renderer and no job queue here.
 */
const exportRows = asyncHandler(async (req, res) => {
    const data = await rsvpService.exportRows(req.websiteClient.id, {
        event_id: req.query.event_id,
        group_id: req.query.group_id,
        status: req.query.status,
        search: req.query.search,
        from: req.query.from,
        to: req.query.to,
    });
    return ApiResponse.success(res, data, 'Export ready');
});

const getById = asyncHandler(async (req, res) => {
    const data = await rsvpService.getById(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, data, 'RSVP retrieved');
});

const update = asyncHandler(async (req, res) => {
    const data = await rsvpService.update(req.websiteClient.id, req.params.id, req.body);
    logger.logRequest(req, `Client ${req.websiteClient.id} updated RSVP ${req.params.id}`);
    return ApiResponse.success(res, data, 'RSVP updated');
});

/**
 * Clear the response.
 *
 * The message says what actually happened. "Deleted" would be wrong — the guest
 * is still on the list and can answer again, which is the whole point of this
 * being a reset rather than a delete.
 */
const resetResponse = asyncHandler(async (req, res) => {
    const data = await rsvpService.resetResponse(
        req.websiteClient.id, req.params.id, req.body?.reason,
    );
    logger.logRequest(req, `Client ${req.websiteClient.id} cleared RSVP ${req.params.id}`);
    return ApiResponse.success(res, data, 'Response cleared — the guest can respond again');
});

const getGroup = asyncHandler(async (req, res) => {
    const data = await rsvpService.getGroup(req.websiteClient.id, req.params.id, {
        event_id: req.query.event_id,
    });
    return ApiResponse.success(res, data, 'Group retrieved');
});

const moveToGroup = asyncHandler(async (req, res) => {
    const data = await rsvpService.moveToGroup(
        req.websiteClient.id, req.params.id, req.body?.group_id,
    );
    logger.logRequest(req, `Client ${req.websiteClient.id} moved guest ${req.params.id} to a group`);
    return ApiResponse.success(res, data, 'Guest moved');
});

module.exports = {
    list, stats, exportRows, getById, update, resetResponse, getGroup, moveToGroup,
};
