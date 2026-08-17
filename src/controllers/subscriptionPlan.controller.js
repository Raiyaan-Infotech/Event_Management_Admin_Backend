const subscriptionPlanService = require('../services/subscriptionPlan.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await subscriptionPlanService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} subscription plans`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const subscriptionPlan = await subscriptionPlanService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched subscription plan ${req.params.id}`);
    return ApiResponse.success(res, { subscriptionPlan });
});

/**
 * Wizard step 4 renders whatever this returns, so the limit fields live in one
 * place instead of being duplicated in the frontend.
 */
const getLimitCatalog = asyncHandler(async (req, res) => {
    const catalog = subscriptionPlanService.getLimitCatalog();
    logger.logRequest(req, 'Fetched plan limit catalog');
    return ApiResponse.success(res, { catalog });
});

const create = asyncHandler(async (req, res) => {
    const subscriptionPlan = await subscriptionPlanService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created subscription plan: ${subscriptionPlan.name}`);
    return ApiResponse.success(res, { subscriptionPlan }, 'Subscription plan created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const subscriptionPlan = await subscriptionPlanService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated subscription plan ${req.params.id}`);
    return ApiResponse.success(res, { subscriptionPlan }, 'Subscription plan updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const subscriptionPlan = await subscriptionPlanService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for subscription plan ${req.params.id}`);
    return ApiResponse.success(res, { subscriptionPlan }, 'Subscription plan status updated successfully');
});

/** Reason options for the Deactivate / Delete confirm screens. */
const getReasons = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, { reasons: subscriptionPlanService.getReasons() });
});

const deactivate = asyncHandler(async (req, res) => {
    const subscriptionPlan = await subscriptionPlanService.deactivate(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Deactivated subscription plan ${req.params.id}`);
    return ApiResponse.success(res, { subscriptionPlan }, 'Plan deactivated successfully');
});

const reactivate = asyncHandler(async (req, res) => {
    const subscriptionPlan = await subscriptionPlanService.reactivate(
        req.params.id,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Reactivated subscription plan ${req.params.id}`);
    return ApiResponse.success(res, { subscriptionPlan }, 'Plan activated successfully');
});

/**
 * Delete with a reason. The response carries the pre-deletion snapshot, because
 * the success screen cannot re-read a soft-deleted row.
 */
const deleteWithReason = asyncHandler(async (req, res) => {
    const subscriptionPlan = await subscriptionPlanService.deleteWithReason(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Deleted subscription plan ${req.params.id} with reason`);
    return ApiResponse.success(res, { subscriptionPlan }, 'Plan deleted successfully');
});

const duplicate = asyncHandler(async (req, res) => {
    const subscriptionPlan = await subscriptionPlanService.duplicate(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Duplicated subscription plan ${req.params.id}`);
    return ApiResponse.success(res, { subscriptionPlan }, 'Subscription plan duplicated successfully', 201);
});

const deleteById = asyncHandler(async (req, res) => {
    await subscriptionPlanService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted subscription plan ${req.params.id}`);
    return ApiResponse.success(res, null, 'Subscription plan deleted successfully');
});

module.exports = {
    getAll,
    getById,
    getLimitCatalog,
    getReasons,
    deactivate,
    reactivate,
    deleteWithReason,
    create,
    update,
    updateStatus,
    duplicate,
    deleteById,
};
