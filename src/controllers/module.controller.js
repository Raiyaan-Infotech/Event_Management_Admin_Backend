const moduleService = require('../services/module.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all modules
 * GET /api/v1/modules
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await moduleService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all modules');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get module by ID
 * GET /api/v1/modules/:id
 */
const getById = asyncHandler(async (req, res) => {
  const moduleData = await moduleService.getById(req.params.id, req.companyId);

  logger.logRequest(req, 'Get module by ID');
  return ApiResponse.success(res, { module: moduleData });
});

/**
 * Create new module (auto-generates permissions)
 * POST /api/v1/modules
 */
const create = asyncHandler(async (req, res) => {
  const moduleData = await moduleService.create(
    req.body, 
    req.user.id, 
    req.companyId
  );

  logger.logRequest(req, 'Create module');
  return ApiResponse.created(res, { module: moduleData }, 'Module created with permissions successfully');
});

/**
 * Update module
 * PUT /api/v1/modules/:id
 */
const update = asyncHandler(async (req, res) => {
  const moduleData = await moduleService.update(
    req.params.id, 
    req.body, 
    req.user.id, 
    req.companyId
  );

  logger.logRequest(req, 'Update module');
  return ApiResponse.success(res, { module: moduleData }, 'Module updated successfully');
});

/**
 * Delete module
 * DELETE /api/v1/modules/:id
 */
const remove = asyncHandler(async (req, res) => {
  await moduleService.remove(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Delete module');
  return ApiResponse.success(res, null, 'Module deleted successfully');
});

/**
 * Add custom permission to module
 * POST /api/v1/modules/:id/permissions
 */
const addPermission = asyncHandler(async (req, res) => {
  const moduleData = await moduleService.addPermission(
    req.params.id, 
    req.body, 
    req.user.id, 
    req.companyId
  );

  logger.logRequest(req, 'Add custom permission to module');
  return ApiResponse.created(res, { module: moduleData }, 'Custom permission added successfully');
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: remove,
  addPermission,
};