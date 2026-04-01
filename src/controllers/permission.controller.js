const permissionService = require('../services/permission.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all permissions
 * GET /api/v1/permissions
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await permissionService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all permissions');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get permission by ID
 * GET /api/v1/permissions/:id
 */
const getById = asyncHandler(async (req, res) => {
  const permission = await permissionService.getById(req.params.id, req.companyId);

  logger.logRequest(req, 'Get permission by ID');
  return ApiResponse.success(res, { permission });
});

/**
 * Create new permission
 * POST /api/v1/permissions
 */
const create = asyncHandler(async (req, res) => {
  const permission = await permissionService.create(
    req.body, 
    req.user.id, 
    req.companyId
  );

  logger.logRequest(req, 'Create permission');
  return ApiResponse.created(res, { permission }, 'Permission created successfully');
});

/**
 * Update permission
 * PUT /api/v1/permissions/:id
 */
const update = asyncHandler(async (req, res) => {
  const permission = await permissionService.update(
    req.params.id, 
    req.body, 
    req.user.id, 
    req.companyId
  );

  logger.logRequest(req, 'Update permission');
  return ApiResponse.success(res, { permission }, 'Permission updated successfully');
});

/**
 * Delete permission
 * DELETE /api/v1/permissions/:id
 */
const remove = asyncHandler(async (req, res) => {
  await permissionService.remove(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Delete permission');
  return ApiResponse.success(res, null, 'Permission deleted successfully');
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: remove,
};