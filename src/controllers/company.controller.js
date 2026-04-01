const companyService = require('../services/company.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all companies
 * GET /api/v1/companies
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await companyService.getAll(req.query);

  logger.logRequest(req, 'Get all companies');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get developer dashboard
 * GET /api/v1/companies/dashboard
 */
const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await companyService.getDashboard();

  logger.logRequest(req, 'Get developer dashboard');
  return ApiResponse.success(res, dashboard);
});

/**
 * Get company by ID
 * GET /api/v1/companies/:id
 */
const getById = asyncHandler(async (req, res) => {
  const company = await companyService.getById(req.params.id);

  logger.logRequest(req, 'Get company by ID');
  return ApiResponse.success(res, { company });
});

/**
 * Create new company
 * POST /api/v1/companies
 */
const create = asyncHandler(async (req, res) => {
  const company = await companyService.create(req.body, req.user.id);

  logger.logRequest(req, 'Create company');
  return ApiResponse.created(res, { company }, 'Company created successfully');
});

/**
 * Update company
 * PUT /api/v1/companies/:id
 */
const update = asyncHandler(async (req, res) => {
  const company = await companyService.update(req.params.id, req.body, req.user.id);

  logger.logRequest(req, 'Update company');
  return ApiResponse.success(res, { company }, 'Company updated successfully');
});

/**
 * Delete company
 * DELETE /api/v1/companies/:id
 */
const remove = asyncHandler(async (req, res) => {
  await companyService.remove(req.params.id, req.user.id);

  logger.logRequest(req, 'Delete company');
  return ApiResponse.success(res, null, 'Company deleted successfully');
});

/**
 * Update company status
 * PATCH /api/v1/companies/:id/status
 */
const updateStatus = asyncHandler(async (req, res) => {
  const { is_active } = req.body;
  const company = await companyService.updateStatus(req.params.id, is_active, req.user.id);

  logger.logRequest(req, 'Update company status');
  return ApiResponse.success(res, { company }, 'Company status updated successfully');
});

module.exports = {
  getAll,
  getDashboard,
  getById,
  create,
  update,
  delete: remove,
  updateStatus,
};