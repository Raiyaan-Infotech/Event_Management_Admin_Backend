const notificationTemplateService = require('../services/notificationTemplate.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await notificationTemplateService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} notification templates`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getVariables = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, { variables: notificationTemplateService.getAvailableVariables() });
});

const getSystemTriggers = asyncHandler(async (req, res) => {
    return ApiResponse.success(res, { triggers: notificationTemplateService.getSystemTriggers() });
});

const getById = asyncHandler(async (req, res) => {
    const template = await notificationTemplateService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched notification template ${req.params.id}`);
    return ApiResponse.success(res, { template });
});

const create = asyncHandler(async (req, res) => {
    const template = await notificationTemplateService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created notification template: ${template.name}`);
    return ApiResponse.success(res, { template }, 'Notification template created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const template = await notificationTemplateService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated notification template ${req.params.id}`);
    return ApiResponse.success(res, { template }, 'Notification template updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const template = await notificationTemplateService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for notification template ${req.params.id}`);
    return ApiResponse.success(res, { template }, 'Notification template status updated successfully');
});

const duplicate = asyncHandler(async (req, res) => {
    const template = await notificationTemplateService.duplicate(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Duplicated notification template ${req.params.id}`);
    return ApiResponse.success(res, { template }, 'Notification template duplicated successfully', 201);
});

const deleteById = asyncHandler(async (req, res) => {
    await notificationTemplateService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted notification template ${req.params.id}`);
    return ApiResponse.success(res, null, 'Notification template deleted successfully');
});

module.exports = {
    getAll,
    getVariables,
    getSystemTriggers,
    getById,
    create,
    update,
    updateStatus,
    duplicate,
    deleteById,
};
