const religionService = require('../services/religion.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await religionService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} religions`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const religion = await religionService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched religion ${req.params.id}`);
    return ApiResponse.success(res, { religion });
});

const create = asyncHandler(async (req, res) => {
    const religion = await religionService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created religion: ${religion.name}`);
    return ApiResponse.success(res, { religion }, 'Religion created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const religion = await religionService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated religion ${req.params.id}`);
    return ApiResponse.success(res, { religion }, 'Religion updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const religion = await religionService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for religion ${req.params.id}`);
    return ApiResponse.success(res, { religion }, 'Religion status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await religionService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted religion ${req.params.id}`);
    return ApiResponse.success(res, null, 'Religion deleted successfully');
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
