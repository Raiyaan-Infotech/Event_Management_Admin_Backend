const emailTemplateService = require('../services/emailTemplate.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all email templates
 * GET /api/v1/email-templates
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await emailTemplateService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all email templates');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get email template by ID
 * GET /api/v1/email-templates/:id
 */
const getById = asyncHandler(async (req, res) => {
  const template = await emailTemplateService.getById(req.params.id, req.companyId);

  logger.logRequest(req, 'Get email template by ID');
  return ApiResponse.success(res, { template });
});

/**
 * Get available headers and footers
 * GET /api/v1/email-templates/parts
 */
const getParts = asyncHandler(async (req, res) => {
  const result = await emailTemplateService.getPartsTemplates(req.companyId);

  logger.logRequest(req, 'Get template parts (headers/footers)');
  return ApiResponse.success(res, result);
});

/**
 * Create new email template
 * POST /api/v1/email-templates
 */
const create = asyncHandler(async (req, res) => {
  const template = await emailTemplateService.create(req.body, req.user.id, req.companyId);

  logger.logRequest(req, 'Create email template');
  return ApiResponse.created(res, { template }, 'Email template created successfully');
});

/**
 * Update email template
 * PUT /api/v1/email-templates/:id
 */
const update = asyncHandler(async (req, res) => {
  const template = await emailTemplateService.update(req.params.id, req.body, req.user.id, req.companyId);

  logger.logRequest(req, 'Update email template');
  return ApiResponse.success(res, { template }, 'Email template updated successfully');
});

/**
 * Toggle active status
 * PATCH /api/v1/email-templates/:id/toggle-active
 */
const toggleActive = asyncHandler(async (req, res) => {
  const template = await emailTemplateService.toggleActive(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Toggle email template active status');
  return ApiResponse.success(res, { template }, 'Status updated successfully');
});

/**
 * Delete email template
 * DELETE /api/v1/email-templates/:id
 */
const remove = asyncHandler(async (req, res) => {
  await emailTemplateService.remove(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Delete email template');
  return ApiResponse.success(res, null, 'Email template deleted successfully');
});

/**
 * Preview email template
 * POST /api/v1/email-templates/:id/preview
 */
const preview = asyncHandler(async (req, res) => {
  const { variables } = req.body;
  const result = await emailTemplateService.preview(req.params.id, variables, req.companyId);

  logger.logRequest(req, 'Preview email template');
  return ApiResponse.success(res, result);
});

/**
 * Send email using template
 * POST /api/v1/email-templates/:id/send
 */
const send = asyncHandler(async (req, res) => {
  const { to, variables } = req.body;
  const result = await emailTemplateService.send(
    req.params.id,
    { to, variables },
    req.user.id,
    req.companyId
  );

  logger.logRequest(req, 'Send email using template');
  return ApiResponse.success(res, result, 'Email sent successfully');
});

/**
 * Get available template variables
 * GET /api/v1/email-templates/variables
 */
const getVariables = asyncHandler(async (req, res) => {
  const variables = await emailTemplateService.getAvailableVariables();

  logger.logRequest(req, 'Get available template variables');
  return ApiResponse.success(res, { variables });
});

module.exports = {
  getAll,
  getById,
  getParts,
  create,
  update,
  toggleActive,
  delete: remove,
  preview,
  send,
  getVariables,
};