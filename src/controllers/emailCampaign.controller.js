const emailCampaignService = require('../services/emailCampaign.service');
const emailSchedulerService = require('../services/emailScheduler.service');
const emailWorkerService = require('../services/emailWorker.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all email campaigns
 * GET /api/v1/email-campaigns
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await emailCampaignService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all email campaigns');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get email campaign by ID
 * GET /api/v1/email-campaigns/:id
 */
const getById = asyncHandler(async (req, res) => {
  const campaign = await emailCampaignService.getById(req.params.id, req.companyId);

  logger.logRequest(req, 'Get email campaign by ID');
  return ApiResponse.success(res, { campaign });
});

/**
 * Create new email campaign
 * POST /api/v1/email-campaigns
 */
const create = asyncHandler(async (req, res) => {
  const campaign = await emailCampaignService.create(req.body, req.user.id, req.companyId);

  logger.logRequest(req, 'Create email campaign');
  return ApiResponse.created(res, { campaign }, 'Email campaign created successfully');
});

/**
 * Update email campaign
 * PUT /api/v1/email-campaigns/:id
 */
const update = asyncHandler(async (req, res) => {
  const campaign = await emailCampaignService.update(req.params.id, req.body, req.user.id, req.companyId);

  logger.logRequest(req, 'Update email campaign');
  return ApiResponse.success(res, { campaign }, 'Email campaign updated successfully');
});

/**
 * Delete email campaign
 * DELETE /api/v1/email-campaigns/:id
 */
const remove = asyncHandler(async (req, res) => {
  await emailCampaignService.remove(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Delete email campaign');
  return ApiResponse.success(res, null, 'Email campaign deleted successfully');
});

/**
 * Get available holidays
 * GET /api/v1/email-campaigns/holidays
 */
const getHolidays = asyncHandler(async (req, res) => {
  const holidays = emailCampaignService.getHolidays();

  logger.logRequest(req, 'Get available holidays');
  return ApiResponse.success(res, { holidays });
});

/**
 * Get campaign statistics
 * GET /api/v1/email-campaigns/:id/statistics
 */
const getStatistics = asyncHandler(async (req, res) => {
  const statistics = await emailCampaignService.getStatistics(req.params.id, req.companyId);

  logger.logRequest(req, 'Get campaign statistics');
  return ApiResponse.success(res, { statistics });
});

/**
 * Activate campaign
 * POST /api/v1/email-campaigns/:id/activate
 */
const activate = asyncHandler(async (req, res) => {
  const campaign = await emailCampaignService.activate(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Activate email campaign');
  return ApiResponse.success(res, { campaign }, 'Email campaign activated successfully');
});

/**
 * Pause campaign
 * POST /api/v1/email-campaigns/:id/pause
 */
const pause = asyncHandler(async (req, res) => {
  const campaign = await emailCampaignService.pause(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Pause email campaign');
  return ApiResponse.success(res, { campaign }, 'Email campaign paused successfully');
});

/**
 * Manually trigger campaign (for testing)
 * POST /api/v1/email-campaigns/:id/trigger
 */
const trigger = asyncHandler(async (req, res) => {
  const result = await emailSchedulerService.triggerCampaign(req.params.id, req.companyId);

  logger.logRequest(req, 'Trigger email campaign');
  return ApiResponse.success(res, { result }, 'Campaign triggered successfully');
});

/**
 * Get queue statistics
 * GET /api/v1/email-campaigns/queue/stats
 */
const getQueueStats = asyncHandler(async (req, res) => {
  const stats = await emailWorkerService.getQueueStats(req.companyId);

  logger.logRequest(req, 'Get queue statistics');
  return ApiResponse.success(res, { stats });
});

/**
 * Process queue manually (for testing)
 * POST /api/v1/email-campaigns/queue/process
 */
const processQueue = asyncHandler(async (req, res) => {
  const result = await emailWorkerService.processQueue();

  logger.logRequest(req, 'Process email queue');
  return ApiResponse.success(res, { result }, 'Queue processed successfully');
});

/**
 * Get default variable mappings
 * GET /api/v1/email-campaigns/variable-mappings
 */
const getVariableMappings = asyncHandler(async (req, res) => {
  const mappings = emailCampaignService.getDefaultVariableMappings();

  logger.logRequest(req, 'Get variable mappings');
  return ApiResponse.success(res, { mappings });
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: remove,
  getHolidays,
  getStatistics,
  activate,
  pause,
  trigger,
  getQueueStats,
  processQueue,
  getVariableMappings,
};