const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const service = require('../services/clientEventNotificationTemplate.service');

const summary = asyncHandler(async (req, res) => {
    const data = await service.summaryForClient(req.websiteClient.id);
    return ApiResponse.success(res, data, 'Notification template summary retrieved');
});

const listApplicable = asyncHandler(async (req, res) => {
    const data = await service.listApplicable(req.websiteClient.id, req.params.id);
    if (!data) throw ApiError.notFound('Event not found.');
    return ApiResponse.success(res, data, 'Applicable notification templates retrieved');
});

const toggle = asyncHandler(async (req, res) => {
    const result = await service.toggle(
        req.websiteClient.id,
        req.params.id,
        req.params.templateId,
        req.body.enabled
    );
    if (!result) throw ApiError.notFound('Event or notification template not found.');
    return ApiResponse.success(res, result, 'Notification template preference updated');
});

const testTrigger = asyncHandler(async (req, res) => {
    const notificationTrigger = require('../services/notificationTrigger.service');
    const owned = await service.listApplicable(req.websiteClient.id, req.params.id);
    if (!owned) throw ApiError.notFound('Event not found.');

    const result = await notificationTrigger.triggerWelcomeInvitation({
        eventId: req.params.id,
        guest: req.body.guest || { name: req.websiteClient.name || 'Sample Guest' },
        client: req.websiteClient,
        companyId: req.websiteClient.company_id,
    });
    return ApiResponse.success(
        res,
        result,
        result.triggered
            ? 'Welcome Invitation triggered successfully'
            : (result.reason === 'disabled_by_client_portal'
                ? 'Welcome Invitation is disabled for this event in client portal'
                : 'Welcome Invitation was not triggered')
    );
});

module.exports = {
    summary,
    listApplicable,
    toggle,
    testTrigger,
};
