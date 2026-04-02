const menuService = require('../services/menu.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await menuService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} menus`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const menu = await menuService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched menu ${req.params.id}`);
    return ApiResponse.success(res, { menu });
});

const create = asyncHandler(async (req, res) => {
    const menu = await menuService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created menu: ${menu.name}`);
    return ApiResponse.success(res, { menu }, 'Menu created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const menu = await menuService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated menu ${req.params.id}`);
    return ApiResponse.success(res, { menu }, 'Menu updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const menu = await menuService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for menu ${req.params.id}`);
    return ApiResponse.success(res, { menu }, 'Menu status updated successfully');
});

const updateDisplayStatus = asyncHandler(async (req, res) => {
    const menu = await menuService.updateDisplayStatus(
        req.params.id,
        req.body.display_status,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated display status for menu ${req.params.id}`);
    return ApiResponse.success(res, { menu }, 'Menu display status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await menuService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted menu ${req.params.id}`);
    return ApiResponse.success(res, null, 'Menu deleted successfully');
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    updateDisplayStatus,
    deleteById,
};
