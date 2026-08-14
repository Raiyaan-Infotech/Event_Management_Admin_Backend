const eventCategoryService = require('../services/eventCategory.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await eventCategoryService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} event categories`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const eventCategory = await eventCategoryService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched event category ${req.params.id}`);
    return ApiResponse.success(res, { eventCategory });
});

const create = asyncHandler(async (req, res) => {
    const eventCategory = await eventCategoryService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created event category: ${eventCategory.name}`);
    return ApiResponse.success(res, { eventCategory }, 'Event category created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const eventCategory = await eventCategoryService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated event category ${req.params.id}`);
    return ApiResponse.success(res, { eventCategory }, 'Event category updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const eventCategory = await eventCategoryService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for event category ${req.params.id}`);
    return ApiResponse.success(res, { eventCategory }, 'Event category status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await eventCategoryService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted event category ${req.params.id}`);
    return ApiResponse.success(res, null, 'Event category deleted successfully');
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
