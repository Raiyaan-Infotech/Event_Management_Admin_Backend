const userService = require('../services/user.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all users
 * GET /api/v1/users
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await userService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all users');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get user by ID
 * GET /api/v1/users/:id
 */
const getById = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.params.id, req.companyId);

  logger.logRequest(req, 'Get user by ID');
  return ApiResponse.success(res, { user });
});

/**
 * Create new user
 * POST /api/v1/users
 */
const create = asyncHandler(async (req, res) => {
  console.log('Received request body:', JSON.stringify(req.body, null, 2));
  const user = await userService.create(
    req.body, 
    req.user.id, 
    req.companyId, 
    req.user.role?.level
  );

  logger.logRequest(req, 'Create user');
  return ApiResponse.created(res, { user }, 'User created successfully');
});

/**
 * Update user
 * PUT /api/v1/users/:id
 */
const update = asyncHandler(async (req, res) => {
  const user = await userService.update(
    req.params.id, 
    req.body, 
    req.user.id, 
    req.companyId
  );

  logger.logRequest(req, 'Update user');
  return ApiResponse.success(res, { user }, 'User updated successfully');
});

/**
 * Delete user
 * DELETE /api/v1/users/:id
 */
const remove = asyncHandler(async (req, res) => {
  await userService.remove(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Delete user');
  return ApiResponse.success(res, null, 'User deleted successfully');
});

/**
 * Update user status
 * PATCH /api/v1/users/:id/status
 */
const updateStatus = asyncHandler(async (req, res) => {
  const { is_active } = req.body;
  const user = await userService.updateStatus(
    req.params.id,
    is_active,
    req.user.id,
    req.companyId
  );

  logger.logRequest(req, 'Update user status');
  return ApiResponse.success(res, { user }, 'User status updated successfully');
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: remove,
  updateStatus,
};