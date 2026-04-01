const roleService = require('../services/role.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
  const result = await roleService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all roles');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
  const role = await roleService.getById(req.params.id, req.companyId);

  logger.logRequest(req, 'Get role by ID');
  return ApiResponse.success(res, { role });
});

const create = asyncHandler(async (req, res) => {
  const role = await roleService.create(req.body, req.user.id, req.companyId);

  logger.logRequest(req, 'Create role');
  return ApiResponse.created(res, { role }, 'Role created successfully');
});

const update = asyncHandler(async (req, res) => {
  const role = await roleService.update(req.params.id, req.body, req.user.id, req.companyId);

  logger.logRequest(req, 'Update role');
  return ApiResponse.success(res, { role }, 'Role updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await roleService.remove(req.params.id, req.user.id, req.companyId);

  logger.logRequest(req, 'Delete role');
  return ApiResponse.success(res, null, 'Role deleted successfully');
});

const assignPermissions = asyncHandler(async (req, res) => {
  const { permission_ids, permissions } = req.body;

  // Support both formats:
  // Old: { permission_ids: [1, 2, 3] }
  // New: { permissions: [{ permissionId: 1, requiresApproval: false }, ...] }
  const permissionsData = permissions || (permission_ids || []).map(id => (typeof id === 'object' ? id : id));

  const role = await roleService.assignPermissions(req.params.id, permissionsData, req.user.id, req.companyId);

  logger.logRequest(req, 'Assign permissions to role');
  return ApiResponse.success(res, { role }, 'Permissions assigned successfully');
});

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: remove,
  assignPermissions,
};
