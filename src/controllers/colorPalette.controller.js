const colorPaletteService = require('../services/colorPalette.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await colorPaletteService.getAll(req.query, req.company?.id);
    logger.logRequest(req, 'Get all color palettes');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const palette = await colorPaletteService.getById(req.params.id, req.company?.id);
    logger.logRequest(req, 'Get color palette by ID');
    return ApiResponse.success(res, { palette });
});

const create = asyncHandler(async (req, res) => {
    const { name, primary_color, secondary_color, header_color, footer_color, text_color, hover_color, is_active } = req.body;
    const palette = await colorPaletteService.create(
        { name, primary_color, secondary_color, header_color, footer_color, text_color, hover_color, is_active },
        req.user.id,
        req.company?.id
    );
    logger.logRequest(req, 'Create color palette');
    return ApiResponse.created(res, { palette }, 'Color palette created successfully');
});

const update = asyncHandler(async (req, res) => {
    const { name, primary_color, secondary_color, header_color, footer_color, text_color, hover_color, is_active } = req.body;
    const palette = await colorPaletteService.update(
        req.params.id,
        { name, primary_color, secondary_color, header_color, footer_color, text_color, hover_color, is_active },
        req.user.id,
        req.company?.id
    );
    logger.logRequest(req, 'Update color palette');
    return ApiResponse.success(res, { palette }, 'Color palette updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await colorPaletteService.remove(req.params.id, req.user.id, req.company?.id);
    logger.logRequest(req, 'Delete color palette');
    return ApiResponse.success(res, null, 'Color palette deleted successfully');
});

module.exports = { getAll, getById, create, update, remove };
