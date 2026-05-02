const themeService = require('../services/theme.service');
const mediaService = require('../services/media.service');
const { Theme } = require('../models');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getThemes = asyncHandler(async (req, res) => {
    const result = await themeService.getThemes(req.query, req.companyId);
    logger.logRequest(req, 'Get all themes');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getThemeById = asyncHandler(async (req, res) => {
    const theme = await themeService.getThemeById(req.params.id, req.companyId);
    logger.logRequest(req, 'Get theme by ID');
    return ApiResponse.success(res, { theme });
});

const createTheme = asyncHandler(async (req, res) => {
    const theme = await themeService.createTheme(req.body, req.user.id, req.companyId);
    logger.logRequest(req, 'Create theme');
    return ApiResponse.created(res, { theme }, 'Theme created successfully');
});

const updateTheme = asyncHandler(async (req, res) => {
    const theme = await themeService.updateTheme(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, 'Update theme');
    return ApiResponse.success(res, { theme }, 'Theme updated successfully');
});

const deleteTheme = asyncHandler(async (req, res) => {
    await themeService.deleteTheme(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, 'Delete theme');
    return ApiResponse.success(res, null, 'Theme deleted successfully');
});

const getThemeByPlan = asyncHandler(async (req, res) => {
    const theme = await themeService.getThemeByPlan(req.params.planId, req.companyId);
    logger.logRequest(req, 'Get theme by plan');
    return ApiResponse.success(res, { theme });
});

const uploadPreviewImage = asyncHandler(async (req, res) => {
    const theme = await Theme.findByPk(req.params.id);
    if (!theme) throw ApiError.notFound('Theme not found');

    if (!req.file) throw ApiError.badRequest('No file provided');

    const result = await mediaService.upload(req.file, { folder: 'themes' }, req.companyId);
    await theme.update({ preview_image: result.url });

    logger.logRequest(req, 'Upload theme preview image');
    return ApiResponse.success(res, { preview_image: result.url }, 'Preview image uploaded');
});

module.exports = {
    getThemes,
    getThemeById,
    createTheme,
    updateTheme,
    deleteTheme,
    getThemeByPlan,
    uploadPreviewImage,
};
