const decorationService = require('../services/decoration.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await decorationService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} decorations`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

/** The tiles above the list — Total / Active / Inactive / storage used. */
const getStats = asyncHandler(async (req, res) => {
    const stats = await decorationService.getStats(req.companyId);
    logger.logRequest(req, 'Fetched decoration stats');
    return ApiResponse.success(res, { stats });
});

const getById = asyncHandler(async (req, res) => {
    const decoration = await decorationService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched decoration ${req.params.id}`);
    return ApiResponse.success(res, { decoration });
});

const create = asyncHandler(async (req, res) => {
    const decoration = await decorationService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created decoration: ${decoration.name}`);
    return ApiResponse.success(res, { decoration }, 'Decoration uploaded successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const decoration = await decorationService.update(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Updated decoration ${req.params.id}`);
    return ApiResponse.success(res, { decoration }, 'Decoration updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const decoration = await decorationService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for decoration ${req.params.id}`);
    return ApiResponse.success(res, { decoration }, 'Decoration status updated successfully');
});

const reorder = asyncHandler(async (req, res) => {
    const result = await decorationService.reorder(req.body.items, req.user.id, req.companyId);
    logger.logRequest(req, `Reordered ${result.updated} decorations`);
    return ApiResponse.success(res, result, 'Decoration order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await decorationService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted decoration ${req.params.id}`);
    return ApiResponse.success(res, null, 'Decoration deleted successfully');
});

module.exports = {
    getAll, getStats, getById, create, update, updateStatus, reorder, deleteById,
};
