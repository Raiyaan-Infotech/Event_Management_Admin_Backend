const planBadgeService = require('../services/planBadge.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await planBadgeService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} plan badges`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const planBadge = await planBadgeService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched plan badge ${req.params.id}`);
    return ApiResponse.success(res, { planBadge });
});

/** Badge Settings card — the module-level switches. */
const getSettings = asyncHandler(async (req, res) => {
    const settings = await planBadgeService.getSettings(req.companyId);
    return ApiResponse.success(res, { settings });
});

const updateSettings = asyncHandler(async (req, res) => {
    const settings = await planBadgeService.updateSettings(req.body, req.user.id, req.companyId);
    logger.logRequest(req, 'Updated plan badge settings');
    return ApiResponse.success(res, { settings }, 'Badge settings updated successfully');
});

/** Badge Usage Summary card. */
const getSummary = asyncHandler(async (req, res) => {
    const summary = await planBadgeService.getSummary(req.companyId);
    return ApiResponse.success(res, { summary });
});

/** The Recommended Badges strip. */
const getRecommended = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, { recommended: planBadgeService.getRecommended() });
});

const create = asyncHandler(async (req, res) => {
    const planBadge = await planBadgeService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created plan badge: ${planBadge.text}`);
    return ApiResponse.success(res, { planBadge }, 'Badge created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const planBadge = await planBadgeService.update(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Updated plan badge ${req.params.id}`);
    return ApiResponse.success(res, { planBadge }, 'Badge updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const planBadge = await planBadgeService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for plan badge ${req.params.id}`);
    return ApiResponse.success(res, { planBadge }, 'Badge status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await planBadgeService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted plan badge ${req.params.id}`);
    return ApiResponse.success(res, null, 'Badge deleted successfully');
});

module.exports = {
    getAll,
    getById,
    getSettings,
    updateSettings,
    getSummary,
    getRecommended,
    create,
    update,
    updateStatus,
    deleteById,
};
