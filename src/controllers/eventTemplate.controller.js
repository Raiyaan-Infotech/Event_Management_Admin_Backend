const eventTemplateService = require('../services/eventTemplate.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await eventTemplateService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} templates`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

/** The four tiles above the list — Total / Active / Inactive / Featured. */
const getStats = asyncHandler(async (req, res) => {
    const stats = await eventTemplateService.getStats(req.companyId);
    logger.logRequest(req, 'Fetched template stats');
    return ApiResponse.success(res, { stats });
});

const getById = asyncHandler(async (req, res) => {
    const template = await eventTemplateService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched template ${req.params.id}`);
    return ApiResponse.success(res, { template });
});

const create = asyncHandler(async (req, res) => {
    const template = await eventTemplateService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created template: ${template.name}`);
    return ApiResponse.success(res, { template }, 'Template created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const template = await eventTemplateService.update(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Updated template ${req.params.id}`);
    return ApiResponse.success(res, { template }, 'Template updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const template = await eventTemplateService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for template ${req.params.id}`);
    return ApiResponse.success(res, { template }, 'Template status updated successfully');
});

const updateFeatured = asyncHandler(async (req, res) => {
    const template = await eventTemplateService.updateFeatured(
        req.params.id,
        req.body.is_featured,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated featured flag for template ${req.params.id}`);
    return ApiResponse.success(res, { template }, 'Template updated successfully');
});

const duplicate = asyncHandler(async (req, res) => {
    const template = await eventTemplateService.duplicate(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Duplicated template ${req.params.id}`);
    return ApiResponse.success(res, { template }, 'Template duplicated successfully', 201);
});

const reorder = asyncHandler(async (req, res) => {
    const result = await eventTemplateService.reorder(req.body.items, req.user.id, req.companyId);
    logger.logRequest(req, `Reordered ${result.updated} templates`);
    return ApiResponse.success(res, result, 'Template order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await eventTemplateService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted template ${req.params.id}`);
    return ApiResponse.success(res, null, 'Template deleted successfully');
});

module.exports = {
    getAll,
    getStats,
    getById,
    create,
    update,
    updateStatus,
    updateFeatured,
    duplicate,
    reorder,
    deleteById,
};
