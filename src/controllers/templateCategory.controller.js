const templateCategoryService = require('../services/templateCategory.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await templateCategoryService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} template categories`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const category = await templateCategoryService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched template category ${req.params.id}`);
    return ApiResponse.success(res, { category });
});

const create = asyncHandler(async (req, res) => {
    const category = await templateCategoryService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created template category: ${category.name}`);
    return ApiResponse.success(res, { category }, 'Category created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const category = await templateCategoryService.update(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Updated template category ${req.params.id}`);
    return ApiResponse.success(res, { category }, 'Category updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const category = await templateCategoryService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for template category ${req.params.id}`);
    return ApiResponse.success(res, { category }, 'Category status updated successfully');
});

const reorder = asyncHandler(async (req, res) => {
    const result = await templateCategoryService.reorder(req.body.items, req.user.id, req.companyId);
    logger.logRequest(req, `Reordered ${result.updated} template categories`);
    return ApiResponse.success(res, result, 'Category order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    const result = await templateCategoryService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted template category ${req.params.id}`);

    // Deleting a category leaves its frames in place, uncategorised. Said out
    // loud rather than left to be noticed on the Frame Styles list later.
    const orphaned = result?.orphaned_frame_styles || 0;
    const message = orphaned
        ? `Category deleted. ${orphaned} frame style${orphaned === 1 ? '' : 's'} became uncategorised.`
        : 'Category deleted successfully';

    return ApiResponse.success(res, result, message);
});

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    reorder,
    deleteById,
};
