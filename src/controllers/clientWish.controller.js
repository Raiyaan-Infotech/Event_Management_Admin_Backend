const service = require('../services/clientWish.service');
const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');

const list = asyncHandler(async (req, res) => {
    const result = await service.list(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Wishes loaded.');
});

const getOne = asyncHandler(async (req, res) => {
    const wish = await service.getOne(req.websiteClient.id, req.params.wishId);
    return ApiResponse.success(res, { wish }, 'Wish loaded.');
});

const create = asyncHandler(async (req, res) => {
    const wish = await service.create(req.websiteClient.id, req.params.id, req.body, req.file);
    return ApiResponse.created(res, { wish }, 'Your post is published.');
});

const update = asyncHandler(async (req, res) => {
    const wish = await service.update(req.websiteClient.id, req.params.wishId, req.body);
    return ApiResponse.success(res, { wish }, 'Wish updated.');
});

const replaceMedia = asyncHandler(async (req, res) => {
    const wish = await service.replaceMedia(req.websiteClient.id, req.params.wishId, req.file, req.body);
    return ApiResponse.success(res, { wish }, 'Wish updated.');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.remove(req.websiteClient.id, req.params.wishId);
    return ApiResponse.success(res, result, 'Wish deleted.');
});

const like = asyncHandler(async (req, res) => {
    const wish = await service.setLiked(req.websiteClient.id, req.params.wishId, true);
    return ApiResponse.success(res, { wish }, 'Liked.');
});

const unlike = asyncHandler(async (req, res) => {
    const wish = await service.setLiked(req.websiteClient.id, req.params.wishId, false);
    return ApiResponse.success(res, { wish }, 'Like removed.');
});

/** The menu is always hidden; their wishes are kept. Body: remove_wishes (old app builds only). */
const block = asyncHandler(async (req, res) => {
    const result = await service.setBlocked(req.websiteClient.id, req.params.wishId, true, req.body || {});
    return ApiResponse.success(res, result, 'User blocked from wishes.');
});

const unblock = asyncHandler(async (req, res) => {
    const result = await service.setBlocked(req.websiteClient.id, req.params.wishId, false);
    return ApiResponse.success(res, result, 'User unblocked.');
});

const getFilter = asyncHandler(async (req, res) => {
    const result = await service.getFilter(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Content filter loaded.');
});

const updateFilter = asyncHandler(async (req, res) => {
    const result = await service.updateFilter(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.success(res, result, 'Content filter saved.');
});

const getSettings = asyncHandler(async (req, res) => {
    const result = await service.getSettings(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Wish settings loaded.');
});

const updateSettings = asyncHandler(async (req, res) => {
    const result = await service.updateSettings(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.success(res, result, 'Wish settings saved.');
});

module.exports = {
    list, getOne, create, update, replaceMedia, remove, like, unlike, block, unblock, getSettings, updateSettings,
    getFilter, updateFilter,
};
