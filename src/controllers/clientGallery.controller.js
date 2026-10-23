const service = require('../services/clientGallery.service');
const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');

const list = asyncHandler(async (req, res) => {
    const result = await service.listItems(req.websiteClient.id, req.params.id, req.query);
    return ApiResponse.success(res, result, 'Gallery loaded.');
});

const usage = asyncHandler(async (req, res) => {
    const result = await service.getUsage(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Gallery usage loaded.');
});

const upload = asyncHandler(async (req, res) => {
    const result = await service.uploadItem(
        req.websiteClient.id, req.params.id, req.file, req.body
    );
    return ApiResponse.success(res, result, 'Uploaded.');
});

/** Change a video's / short's cover: `file` = the picture. */
const replaceCover = asyncHandler(async (req, res) => {
    const result = await service.replaceCover(req.websiteClient.id, req.params.itemId, req.file);
    return ApiResponse.success(res, result, 'Cover updated.');
});

/** Upload Shorts: `file` (the clip) + optional `music` and `cover`. */
const uploadShort = asyncHandler(async (req, res) => {
    const result = await service.uploadShort(
        req.websiteClient.id, req.params.id, req.files || {}, req.body
    );
    return ApiResponse.success(res, result, 'Short uploaded.');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.removeItem(req.websiteClient.id, req.params.itemId);
    return ApiResponse.success(res, result, 'Removed.');
});

const listCategories = asyncHandler(async (req, res) => {
    const result = await service.listCategoriesForViewer(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, { categories: result }, 'Categories loaded.');
});

const createCategory = asyncHandler(async (req, res) => {
    const result = await service.createCategory(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.created(res, { category: result }, 'Category added.');
});

const removeCategory = asyncHandler(async (req, res) => {
    const result = await service.removeCategory(req.websiteClient.id, req.params.categoryId);
    return ApiResponse.success(res, result, 'Category removed.');
});

const updateCategory = asyncHandler(async (req, res) => {
    const result = await service.updateCategory(req.websiteClient.id, req.params.categoryId, req.body);
    return ApiResponse.success(res, result, 'Category updated.');
});

const uploadCategoryCover = asyncHandler(async (req, res) => {
    const result = await service.uploadCategoryCover(req.websiteClient.id, req.params.id, req.file);
    return ApiResponse.success(res, result, 'Image uploaded.');
});

const update = asyncHandler(async (req, res) => {
    const result = await service.updateItem(req.websiteClient.id, req.params.itemId, req.body);
    return ApiResponse.success(res, result, 'Updated.');
});

const reorder = asyncHandler(async (req, res) => {
    const result = await service.reorderItems(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.success(res, result, 'Gallery order saved.');
});

module.exports = {
    list, usage, upload, uploadShort, replaceCover, update, reorder, remove,
    listCategories, createCategory, updateCategory, uploadCategoryCover, removeCategory,
};
