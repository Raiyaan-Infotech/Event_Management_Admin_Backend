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
    const wish = await service.create(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.created(res, { wish }, 'Wish added.');
});

const update = asyncHandler(async (req, res) => {
    const wish = await service.update(req.websiteClient.id, req.params.wishId, req.body);
    return ApiResponse.success(res, { wish }, 'Wish updated.');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.remove(req.websiteClient.id, req.params.wishId);
    return ApiResponse.success(res, result, 'Wish deleted.');
});

const block = asyncHandler(async (req, res) => {
    const wish = await service.setBlocked(req.websiteClient.id, req.params.wishId, true);
    return ApiResponse.success(res, { wish }, 'User blocked from wishes.');
});

const unblock = asyncHandler(async (req, res) => {
    const wish = await service.setBlocked(req.websiteClient.id, req.params.wishId, false);
    return ApiResponse.success(res, { wish }, 'User unblocked.');
});

const uploadPhoto = asyncHandler(async (req, res) => {
    const result = await service.uploadPhoto(req.websiteClient.id, req.params.id, req.file);
    return ApiResponse.success(res, result, 'Photo uploaded.');
});

module.exports = { list, getOne, create, update, remove, block, unblock, uploadPhoto };
