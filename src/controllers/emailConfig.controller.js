const emailConfigService = require('../services/emailConfig.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all email configs
 * GET /api/v1/email-configs
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await emailConfigService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all email configs');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get email config by ID
 * GET /api/v1/email-configs/:id
 */
const getById = asyncHandler(async (req, res) => {
  const emailConfig = await emailConfigService.getById(req.params.id, req.companyId);

  logger.logRequest(req, 'Get email config by ID');
  return ApiResponse.success(res, { emailConfig });
});

/**
 * Create new email config
 * POST /api/v1/email-configs
 */
const create = asyncHandler(async (req, res) => {
  const emailConfig = await emailConfigService.create(req.body, req.user.id, req.companyId);

  logger.logRequest(req, 'Create email config');
  return ApiResponse.created(res, { emailConfig }, 'Email configuration created successfully');
});

/**
 * Update email config
 * PUT /api/v1/email-configs/:id
 */
const update = asyncHandler(async (req, res) => {
  const emailConfig = await emailConfigService.update(req.params.id, req.body, req.user.id, req.companyId);

  logger.logRequest(req, 'Update email config');
  return ApiResponse.success(res, { emailConfig }, 'Email configuration updated successfully');
});

/**
 * Delete email config
 * DELETE /api/v1/email-configs/:id
 */
const remove = asyncHandler(async (req, res) => {
  await emailConfigService.remove(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Delete email config');
  return ApiResponse.success(res, null, 'Email configuration deleted successfully');
});

/**
 * Test email config connection
 * POST /api/v1/email-configs/:id/test
 */
const testConnection = asyncHandler(async (req, res) => {
  const { test_email, template_id } = req.body;
  
  console.log('Test Connection Request:', {
    config_id: req.params.id,
    test_email: test_email || 'none',
    template_id: template_id || 'none'
  });
  
  const result = await emailConfigService.testConnection(
    req.params.id, 
    test_email || null,
    template_id || null,
    req.companyId
  );

  logger.logRequest(req, 'Test email config connection');
  return ApiResponse.success(res, result);
});

/**
 * Debug SMTP connectivity (raw socket test)
 * GET /api/v1/email-configs/:id/debug
 */
const debugConnection = asyncHandler(async (req, res) => {
  const result = await emailConfigService.debugSmtpConnection(req.params.id, req.companyId);

  logger.logRequest(req, 'Debug SMTP connection');
  return ApiResponse.success(res, result);
});

const toggleActive = asyncHandler(async (req, res) => {
  const emailConfig = await emailConfigService.toggleActive(req.params.id, req.user.id, req.companyId);
  logger.logRequest(req, 'Toggle email config active status');
  return ApiResponse.success(res, { emailConfig }, 'Email configuration status updated successfully');
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: remove,
  testConnection,
  debugConnection,
  toggleActive,
};