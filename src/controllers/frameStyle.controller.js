const frameStyleService = require('../services/frameStyle.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await frameStyleService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} frame styles`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

/** The tiles above the list — Total / Active / Inactive / Draft. */
const getStats = asyncHandler(async (req, res) => {
    const stats = await frameStyleService.getStats(req.companyId);
    logger.logRequest(req, 'Fetched frame style stats');
    return ApiResponse.success(res, { stats });
});

const getById = asyncHandler(async (req, res) => {
    const frameStyle = await frameStyleService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched frame style ${req.params.id}`);
    return ApiResponse.success(res, { frameStyle });
});

const create = asyncHandler(async (req, res) => {
    const frameStyle = await frameStyleService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created frame style: ${frameStyle.name}`);
    return ApiResponse.success(res, { frameStyle }, 'Frame style uploaded successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const frameStyle = await frameStyleService.update(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Updated frame style ${req.params.id}`);
    return ApiResponse.success(res, { frameStyle }, 'Frame style updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const frameStyle = await frameStyleService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for frame style ${req.params.id}`);
    return ApiResponse.success(res, { frameStyle }, 'Frame style status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await frameStyleService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted frame style ${req.params.id}`);
    return ApiResponse.success(res, null, 'Frame style deleted successfully');
});

module.exports = {
    getAll,
    getStats,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
