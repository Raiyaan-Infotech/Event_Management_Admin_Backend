const pushNotificationConfigService = require('../services/pushNotificationConfig.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all push notification configs
 * GET /api/v1/push-notification-configs
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await pushNotificationConfigService.getAll(req.query);
  logger.logRequest(req, 'Get all push notification configs');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get active routing project configuration
 * GET /api/v1/push-notification-configs/active
 */
const getActive = asyncHandler(async (req, res) => {
  const pushNotificationConfig = await pushNotificationConfigService.getActive();
  logger.logRequest(req, 'Get active push notification config');
  return ApiResponse.success(res, { pushNotificationConfig });
});

/**
 * Get push notification config by ID
 * GET /api/v1/push-notification-configs/:id
 */
const getById = asyncHandler(async (req, res) => {
  const pushNotificationConfig = await pushNotificationConfigService.getById(req.params.id);
  logger.logRequest(req, 'Get push notification config by ID');
  return ApiResponse.success(res, { pushNotificationConfig });
});

/**
 * Create new push notification config
 * POST /api/v1/push-notification-configs
 */
const create = asyncHandler(async (req, res) => {
  let bodyData = { ...req.body };
  if (req.file) {
    bodyData.service_account_json = req.file.buffer.toString('utf8');
  }

  const pushNotificationConfig = await pushNotificationConfigService.create(bodyData, req.user?.id);
  logger.logRequest(req, 'Create push notification config');
  return ApiResponse.created(res, { pushNotificationConfig }, 'Push notification configuration created successfully');
});

/**
 * Update push notification config
 * PUT /api/v1/push-notification-configs/:id
 */
const update = asyncHandler(async (req, res) => {
  let bodyData = { ...req.body };
  if (req.file) {
    bodyData.service_account_json = req.file.buffer.toString('utf8');
  }

  const pushNotificationConfig = await pushNotificationConfigService.update(req.params.id, bodyData, req.user?.id);
  logger.logRequest(req, 'Update push notification config');
  return ApiResponse.success(res, { pushNotificationConfig }, 'Push notification configuration updated successfully');
});

/**
 * Delete push notification config
 * DELETE /api/v1/push-notification-configs/:id
 */
const remove = asyncHandler(async (req, res) => {
  await pushNotificationConfigService.remove(req.params.id, req.user?.id);
  logger.logRequest(req, 'Delete push notification config');
  return ApiResponse.success(res, null, 'Push notification configuration deleted successfully');
});

/**
 * Toggle or set active routing project
 * PATCH /api/v1/push-notification-configs/:id/toggle
 */
const toggleActive = asyncHandler(async (req, res) => {
  const pushNotificationConfig = await pushNotificationConfigService.toggleActive(req.params.id, req.user?.id);
  logger.logRequest(req, 'Toggle push notification config active status');
  return ApiResponse.success(res, { pushNotificationConfig }, 'Project routing status updated successfully');
});

/**
 * Test handshake connection
 * POST /api/v1/push-notification-configs/:id/test
 */
const testConnection = asyncHandler(async (req, res) => {
  const result = await pushNotificationConfigService.testConnection(req.params.id);
  logger.logRequest(req, 'Test push notification connection');
  return ApiResponse.success(res, result);
});

module.exports = {
  getAll,
  getActive,
  getById,
  create,
  update,
  delete: remove,
  remove,
  toggleActive,
  testConnection,
};
