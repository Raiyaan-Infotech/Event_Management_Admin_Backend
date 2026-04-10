const vendorPermissionService = require('../services/vendorPermission.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getModules = asyncHandler(async (req, res) => {
  const modules = await vendorPermissionService.getModules();
  logger.logRequest(req, 'Vendor: Get modules');
  return ApiResponse.success(res, { modules });
});

const getPermissions = asyncHandler(async (req, res) => {
  const permissions = await vendorPermissionService.getPermissions();
  logger.logRequest(req, 'Vendor: Get permissions');
  return ApiResponse.success(res, { permissions });
});

module.exports = { getModules, getPermissions };
