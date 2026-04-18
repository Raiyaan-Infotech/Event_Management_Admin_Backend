const themeService = require('../services/theme.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getThemes = asyncHandler(async (req, res) => {
    const result = await themeService.getThemes(req.query, req.company?.id);
    logger.logRequest(req, 'Get all themes');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getThemeById = asyncHandler(async (req, res) => {
    const theme = await themeService.getThemeById(req.params.id, req.company?.id);
    logger.logRequest(req, 'Get theme by ID');
    return ApiResponse.success(res, { theme });
});

const createTheme = asyncHandler(async (req, res) => {
    const theme = await themeService.createTheme(req.body, req.user.id, req.company?.id);
    logger.logRequest(req, 'Create theme');
    return ApiResponse.created(res, { theme }, 'Theme created successfully');
});

const updateTheme = asyncHandler(async (req, res) => {
    const theme = await themeService.updateTheme(req.params.id, req.body, req.user.id, req.company?.id);
    logger.logRequest(req, 'Update theme');
    return ApiResponse.success(res, { theme }, 'Theme updated successfully');
});

const deleteTheme = asyncHandler(async (req, res) => {
    await themeService.deleteTheme(req.params.id, req.user.id, req.company?.id);
    logger.logRequest(req, 'Delete theme');
    return ApiResponse.success(res, null, 'Theme deleted successfully');
});

module.exports = {
    getThemes,
    getThemeById,
    createTheme,
    updateTheme,
    deleteTheme
};
