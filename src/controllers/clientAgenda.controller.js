const service = require('../services/clientAgenda.service');
const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');

const list = asyncHandler(async (req, res) => {
    const result = await service.list(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Agenda loaded.');
});

const getOne = asyncHandler(async (req, res) => {
    const item = await service.getOne(req.websiteClient.id, req.params.itemId);
    return ApiResponse.success(res, { item }, 'Agenda item loaded.');
});

const create = asyncHandler(async (req, res) => {
    const item = await service.create(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.created(res, { item }, 'Agenda added.');
});

const update = asyncHandler(async (req, res) => {
    const item = await service.update(req.websiteClient.id, req.params.itemId, req.body);
    return ApiResponse.success(res, { item }, 'Agenda updated.');
});

const duplicate = asyncHandler(async (req, res) => {
    const item = await service.duplicate(req.websiteClient.id, req.params.itemId);
    return ApiResponse.created(res, { item }, 'Agenda duplicated.');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.remove(req.websiteClient.id, req.params.itemId);
    return ApiResponse.success(res, result, 'Agenda deleted.');
});

const reorder = asyncHandler(async (req, res) => {
    const result = await service.reorder(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.success(res, result, 'Agenda order saved.');
});

const uploadImage = asyncHandler(async (req, res) => {
    const result = await service.uploadImage(req.websiteClient.id, req.params.id, req.file);
    return ApiResponse.success(res, result, 'Image uploaded.');
});

module.exports = { list, getOne, create, update, duplicate, remove, reorder, uploadImage };
