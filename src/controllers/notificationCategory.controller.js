const notificationCategoryService = require('../services/notificationCategory.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await notificationCategoryService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} notification categories`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const notificationCategory = await notificationCategoryService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched notification category ${req.params.id}`);
    return ApiResponse.success(res, { notificationCategory });
});

const create = asyncHandler(async (req, res) => {
    const notificationCategory = await notificationCategoryService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created notification category: ${notificationCategory.name}`);
    return ApiResponse.success(res, { notificationCategory }, 'Notification category created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const notificationCategory = await notificationCategoryService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated notification category ${req.params.id}`);
    return ApiResponse.success(res, { notificationCategory }, 'Notification category updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const notificationCategory = await notificationCategoryService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for notification category ${req.params.id}`);
    return ApiResponse.success(res, { notificationCategory }, 'Notification category status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await notificationCategoryService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted notification category ${req.params.id}`);
    return ApiResponse.success(res, null, 'Notification category deleted successfully');
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
