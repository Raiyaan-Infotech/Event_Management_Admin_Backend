const planTypeService = require('../services/planType.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await planTypeService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} subscriptions`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const planType = await planTypeService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched subscription ${req.params.id}`);
    return ApiResponse.success(res, { planType });
});

const create = asyncHandler(async (req, res) => {
    const planType = await planTypeService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created subscription: ${subscription.name}`);
    return ApiResponse.success(res, { planType }, 'Plan type created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const planType = await planTypeService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated subscription ${req.params.id}`);
    return ApiResponse.success(res, { planType }, 'Plan type updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const planType = await planTypeService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for subscription ${req.params.id}`);
    return ApiResponse.success(res, { planType }, 'Plan type status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await planTypeService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted subscription ${req.params.id}`);
    return ApiResponse.success(res, null, 'Plan type deleted successfully');
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
