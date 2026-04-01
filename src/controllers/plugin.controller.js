const pluginService = require('../services/plugin.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all plugins (grouped by category)
 * GET /api/v1/plugins
 */
const getAll = asyncHandler(async (req, res) => {
    const result = await pluginService.getAll(req.companyId);

    logger.logRequest(req, 'Get all plugins');
    return ApiResponse.success(res, result);
});

/**
 * Get single plugin by slug (with config settings)
 * GET /api/v1/plugins/:slug
 */
const getBySlug = asyncHandler(async (req, res) => {
    const { plugin, config } = await pluginService.getBySlug(req.params.slug, req.companyId);

    logger.logRequest(req, `Get plugin: ${req.params.slug}`);
    return ApiResponse.success(res, { plugin, config });
});

/**
 * Toggle plugin enabled/disabled
 * PUT /api/v1/plugins/:slug/toggle
 */
const toggle = asyncHandler(async (req, res) => {
    const plugin = await pluginService.toggle(req.params.slug, req.companyId);

    const stateLabel = plugin.is_active === 1 ? 'enabled' : 'disabled';
    logger.logRequest(req, `Toggle plugin: ${req.params.slug} → ${stateLabel}`);
    return ApiResponse.success(res, { plugin }, `Plugin ${stateLabel} successfully`);
});

module.exports = {
    getAll,
    getBySlug,
    toggle,
};
