const eventMenuService = require('../services/eventMenu.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await eventMenuService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} event menus`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const eventMenu = await eventMenuService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched event menu ${req.params.id}`);
    return ApiResponse.success(res, { eventMenu });
});

const create = asyncHandler(async (req, res) => {
    const eventMenu = await eventMenuService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created event menu: ${eventMenu.name}`);
    return ApiResponse.success(res, { eventMenu }, 'Menu created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const eventMenu = await eventMenuService.update(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Updated event menu ${req.params.id}`);
    return ApiResponse.success(res, { eventMenu }, 'Menu updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const eventMenu = await eventMenuService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for event menu ${req.params.id}`);
    return ApiResponse.success(res, { eventMenu }, 'Menu status updated successfully');
});

/**
 * One route for all four per-platform switches on the list screen. The field
 * name is validated against a whitelist in the service, so `:field` cannot be
 * used to write an arbitrary column.
 */
const updateToggle = asyncHandler(async (req, res) => {
    const eventMenu = await eventMenuService.updateToggle(
        req.params.id,
        req.params.field,
        req.body.value,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated ${req.params.field} for event menu ${req.params.id}`);
    return ApiResponse.success(res, { eventMenu }, 'Menu updated successfully');
});

const duplicate = asyncHandler(async (req, res) => {
    const eventMenu = await eventMenuService.duplicate(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Duplicated event menu ${req.params.id}`);
    return ApiResponse.success(res, { eventMenu }, 'Menu duplicated successfully', 201);
});

const reorder = asyncHandler(async (req, res) => {
    const result = await eventMenuService.reorder(req.body.items, req.user.id, req.companyId);
    logger.logRequest(req, `Reordered ${result.updated} event menus`);
    return ApiResponse.success(res, result, 'Menu order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await eventMenuService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted event menu ${req.params.id}`);
    return ApiResponse.success(res, null, 'Menu deleted successfully');
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    updateToggle,
    duplicate,
    reorder,
    deleteById,
};
