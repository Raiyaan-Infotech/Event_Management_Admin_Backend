const uiBlockCategoryService = require('../services/uiBlockCategory.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getUiBlockCategories = asyncHandler(async (req, res) => {
    const result = await uiBlockCategoryService.getUiBlockCategories(req.query);
    logger.logRequest(req, 'Get all UI block categories');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getUiBlockCategoryById = asyncHandler(async (req, res) => {
    const category = await uiBlockCategoryService.getUiBlockCategoryById(req.params.id);
    logger.logRequest(req, 'Get UI block category by ID');
    return ApiResponse.success(res, { category });
});

const createUiBlockCategory = asyncHandler(async (req, res) => {
    const category = await uiBlockCategoryService.createUiBlockCategory(req.body, req.user?.id);
    logger.logRequest(req, 'Create UI block category');
    return ApiResponse.created(res, { category }, 'UI block category created successfully');
});

const updateUiBlockCategory = asyncHandler(async (req, res) => {
    const category = await uiBlockCategoryService.updateUiBlockCategory(req.params.id, req.body, req.user?.id);
    logger.logRequest(req, 'Update UI block category');
    return ApiResponse.success(res, { category }, 'UI block category updated successfully');
});

const deleteUiBlockCategory = asyncHandler(async (req, res) => {
    await uiBlockCategoryService.deleteUiBlockCategory(req.params.id, req.user?.id);
    logger.logRequest(req, 'Delete UI block category');
    return ApiResponse.success(res, null, 'UI block category deleted successfully');
});

module.exports = { getUiBlockCategories, getUiBlockCategoryById, createUiBlockCategory, updateUiBlockCategory, deleteUiBlockCategory };
