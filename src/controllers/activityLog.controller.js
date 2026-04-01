const activityLogService = require('../services/activityLog.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
  const result = await activityLogService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all activity logs');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

const getByUser = asyncHandler(async (req, res) => {
  const result = await activityLogService.getByUser(req.params.userId, req.query, req.companyId);

  logger.logRequest(req, 'Get activity logs by user');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

const getByModule = asyncHandler(async (req, res) => {
  const result = await activityLogService.getByModule(req.params.module, req.query, req.companyId);

  logger.logRequest(req, 'Get activity logs by module');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

const clearOld = asyncHandler(async (req, res) => {
  const { days = 90 } = req.query;
  const result = await activityLogService.clearOld(parseInt(days), req.companyId);

  logger.logRequest(req, 'Clear old activity logs');
  return ApiResponse.success(res, result, `Cleared ${result.deleted} activity logs older than ${days} days`);
});

module.exports = {
  getAll,
  getByUser,
  getByModule,
  clearOld,
};