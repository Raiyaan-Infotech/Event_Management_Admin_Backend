const subscriptionService = require('../services/subscription.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await subscriptionService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} subscriptions`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched subscription ${req.params.id}`);
    return ApiResponse.success(res, { subscription });
});

const create = asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created subscription: ${subscription.name}`);
    return ApiResponse.success(res, { subscription }, 'Subscription created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated subscription ${req.params.id}`);
    return ApiResponse.success(res, { subscription }, 'Subscription updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for subscription ${req.params.id}`);
    return ApiResponse.success(res, { subscription }, 'Subscription status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await subscriptionService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted subscription ${req.params.id}`);
    return ApiResponse.success(res, null, 'Subscription deleted successfully');
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
