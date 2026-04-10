const vendorRoleService = require('../services/vendorRole.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
  const result = await vendorRoleService.getAll(req.query, req.vendor.id);
  logger.logRequest(req, 'Vendor: Get all roles');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
  const role = await vendorRoleService.getById(req.params.id, req.vendor.id);
  logger.logRequest(req, 'Vendor: Get role by ID');
  return ApiResponse.success(res, { role });
});

const create = asyncHandler(async (req, res) => {
  const role = await vendorRoleService.create(req.body, req.vendor.id);
  logger.logRequest(req, 'Vendor: Create role');
  return ApiResponse.created(res, { role }, 'Role created successfully');
});

const update = asyncHandler(async (req, res) => {
  const role = await vendorRoleService.update(req.params.id, req.body, req.vendor.id);
  logger.logRequest(req, 'Vendor: Update role');
  return ApiResponse.success(res, { role }, 'Role updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await vendorRoleService.remove(req.params.id, req.vendor.id);
  logger.logRequest(req, 'Vendor: Delete role');
  return ApiResponse.success(res, null, 'Role deleted successfully');
});

const assignPermissions = asyncHandler(async (req, res) => {
  const { permission_ids, permissions } = req.body;
  const permissionsData = permissions || (permission_ids || []).map(id => (typeof id === 'object' ? id : id));

  const role = await vendorRoleService.assignPermissions(req.params.id, permissionsData, req.vendor.id);
  logger.logRequest(req, 'Vendor: Assign permissions to role');
  return ApiResponse.success(res, { role }, 'Permissions assigned successfully');
});

module.exports = { getAll, getById, create, update, delete: remove, assignPermissions };
