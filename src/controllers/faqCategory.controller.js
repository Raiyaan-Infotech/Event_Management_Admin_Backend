const faqCategoryService = require('../services/faqCategory.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getFaqCategories = asyncHandler(async (req, res) => {
    const result = await faqCategoryService.getFaqCategories(req.query);
    logger.logRequest(req, 'Get all FAQ categories');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getFaqCategoryById = asyncHandler(async (req, res) => {
    const faqCategory = await faqCategoryService.getFaqCategoryById(req.params.id);
    logger.logRequest(req, 'Get FAQ category by ID');
    return ApiResponse.success(res, { faqCategory });
});

const createFaqCategory = asyncHandler(async (req, res) => {
    const faqCategory = await faqCategoryService.createFaqCategory(req.body, req.user.id);
    logger.logRequest(req, 'Create FAQ category');
    return ApiResponse.created(res, { faqCategory }, 'FAQ category created successfully');
});

const updateFaqCategory = asyncHandler(async (req, res) => {
    const faqCategory = await faqCategoryService.updateFaqCategory(req.params.id, req.body, req.user.id);
    logger.logRequest(req, 'Update FAQ category');
    return ApiResponse.success(res, { faqCategory }, 'FAQ category updated successfully');
});

const deleteFaqCategory = asyncHandler(async (req, res) => {
    await faqCategoryService.deleteFaqCategory(req.params.id, req.user.id);
    logger.logRequest(req, 'Delete FAQ category');
    return ApiResponse.success(res, null, 'FAQ category deleted successfully');
});

module.exports = {
    getFaqCategories,
    getFaqCategoryById,
    createFaqCategory,
    updateFaqCategory,
    deleteFaqCategory,
};
