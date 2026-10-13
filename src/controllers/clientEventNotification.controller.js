const service = require('../services/clientEventNotification.service');
const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');

/**
 * The organizer's notifications from the mobile app. Host-only — the service
 * resolves every event and notification by `req.websiteClient`.
 */

/** Says what really happened: saved, scheduled, or sent and to how many. */
const outcomeMessage = ({ notification, outcome }) => {
    if (notification.status === 'draft') return 'Notification saved as draft.';
    if (notification.status === 'scheduled') return 'Notification scheduled.';
    if (!outcome) return 'Notification saved.';
    return `Notification sent to ${outcome.recipients} participant${outcome.recipients === 1 ? '' : 's'}`
        + (outcome.push
            ? ` — push delivered to ${outcome.delivered}.`
            : ` — saved in the app for ${outcome.delivered}.`);
};

const list = asyncHandler(async (req, res) => {
    const result = await service.list(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Notifications loaded.');
});

const audience = asyncHandler(async (req, res) => {
    const result = await service.audienceOptions(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Audience loaded.');
});

const getOne = asyncHandler(async (req, res) => {
    const notification = await service.getOne(req.websiteClient.id, req.params.notificationId);
    return ApiResponse.success(res, { notification }, 'Notification loaded.');
});

const create = asyncHandler(async (req, res) => {
    const result = await service.create(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.created(res, result, outcomeMessage(result));
});

const update = asyncHandler(async (req, res) => {
    const result = await service.update(req.websiteClient.id, req.params.notificationId, req.body);
    return ApiResponse.success(res, result, outcomeMessage(result));
});

const reschedule = asyncHandler(async (req, res) => {
    const notification = await service.reschedule(req.websiteClient.id, req.params.notificationId, req.body);
    return ApiResponse.success(res, { notification }, 'Notification rescheduled.');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.remove(req.websiteClient.id, req.params.notificationId);
    return ApiResponse.success(res, result, 'Notification deleted.');
});

const uploadImage = asyncHandler(async (req, res) => {
    const result = await service.uploadImage(req.websiteClient.id, req.params.id, req.file);
    return ApiResponse.success(res, result, 'Image uploaded.');
});

module.exports = { list, audience, getOne, create, update, reschedule, remove, uploadImage };
