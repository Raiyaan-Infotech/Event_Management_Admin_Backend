const eventTypeService = require('../services/eventType.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await eventTypeService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} event types`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const eventType = await eventTypeService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched event type ${req.params.id}`);
    return ApiResponse.success(res, { eventType });
});

const create = asyncHandler(async (req, res) => {
    const eventType = await eventTypeService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created event type: ${eventType.name}`);
    return ApiResponse.success(res, { eventType }, 'Event type created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const eventType = await eventTypeService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated event type ${req.params.id}`);
    return ApiResponse.success(res, { eventType }, 'Event type updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const eventType = await eventTypeService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for event type ${req.params.id}`);
    return ApiResponse.success(res, { eventType }, 'Event type status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await eventTypeService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted event type ${req.params.id}`);
    return ApiResponse.success(res, null, 'Event type deleted successfully');
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
