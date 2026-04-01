const settingService = require('../services/setting.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get public settings (for frontend)
 * GET /api/v1/settings/public
 */
const getPublic = asyncHandler(async (req, res) => {
  const settings = await settingService.getPublic(req.companyId);

  logger.logRequest(req, 'Get public settings');
  return ApiResponse.success(res, { settings });
});

/**
 * Get all settings
 * GET /api/v1/settings
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await settingService.getAll(req.query, req.companyId);

  logger.logRequest(req, 'Get all settings');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get settings by group
 * GET /api/v1/settings/group/:group
 */
const getByGroup = asyncHandler(async (req, res) => {
  const settings = await settingService.getByGroup(req.params.group, req.companyId);

  logger.logRequest(req, 'Get settings by group');
  return ApiResponse.success(res, { settings });
});

/**
 * Get setting by key
 * GET /api/v1/settings/:key
 */
const getByKey = asyncHandler(async (req, res) => {
  const setting = await settingService.getByKey(req.params.key, req.companyId);

  logger.logRequest(req, 'Get setting by key');
  return ApiResponse.success(res, { setting });
});

/**
 * Update setting by key
 * PUT /api/v1/settings/:key
 */
const update = asyncHandler(async (req, res) => {
  const { value } = req.body;
  const setting = await settingService.update(req.params.key, value, req.user.id, req.companyId);

  logger.logRequest(req, 'Update setting');
  return ApiResponse.success(res, { setting }, 'Setting updated successfully');
});

/**
 * Bulk update settings
 * POST /api/v1/settings/bulk
 */
const bulkUpdate = asyncHandler(async (req, res) => {
  const { group, ...settings } = req.body;
  const settingGroup = group || 'general';

  // Check group-specific edit permission dynamically from user's loaded permissions
  const roleSlug = req.user.role?.slug;
  if (roleSlug !== 'super_admin' && roleSlug !== 'developer') {
    const userPerms = req.user.role?.permissions || [];
    // Find any .edit permission in the settings module that contains the group name
    const hasEditPerm = userPerms.some(p =>
      p.module === 'settings' && p.slug.endsWith('.edit') && p.slug.includes(settingGroup)
    );
    if (!hasEditPerm) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }
  }

  const result = await settingService.bulkUpdate(settings, settingGroup, req.user.id, req.companyId);

  logger.logRequest(req, 'Bulk update settings');
  return ApiResponse.success(res, { settings: result }, 'Settings updated successfully');
});

module.exports = {
  getPublic,
  getAll,
  getByGroup,
  getByKey,
  update,
  bulkUpdate,
};