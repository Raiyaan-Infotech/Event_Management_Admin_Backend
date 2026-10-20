const service = require('../services/clientLiveStream.service');
const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');

const listTypes = asyncHandler(async (req, res) => {
    const result = await service.listTypes(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Stream types loaded.');
});

const createType = asyncHandler(async (req, res) => {
    const { name, description } = req.body;
    const result = await service.createType(req.websiteClient.id, req.params.id, { name, description });
    return ApiResponse.created(res, result, 'Stream type added.');
});

const updateType = asyncHandler(async (req, res) => {
    const body = {};
    for (const f of ['name', 'description']) {
        if (Object.prototype.hasOwnProperty.call(req.body, f)) body[f] = req.body[f];
    }
    const result = await service.updateType(req.websiteClient.id, req.params.typeId, body);
    return ApiResponse.success(res, result, 'Stream type updated.');
});

const removeType = asyncHandler(async (req, res) => {
    const result = await service.removeType(req.websiteClient.id, req.params.typeId);
    return ApiResponse.success(res, result, 'Stream type deleted.');
});

const reorderTypes = asyncHandler(async (req, res) => {
    const result = await service.reorderTypes(req.websiteClient.id, req.params.id, { ids: req.body.ids });
    return ApiResponse.success(res, result, 'Stream type order saved.');
});

const list = asyncHandler(async (req, res) => {
    const result = await service.list(req.websiteClient.id, req.params.id, { type_id: req.query.type_id });
    return ApiResponse.success(res, result, 'Live streams loaded.');
});

const getOne = asyncHandler(async (req, res) => {
    const result = await service.getOne(req.websiteClient.id, req.params.streamId);
    return ApiResponse.success(res, result, 'Live stream loaded.');
});

/** Every editable field, destructured — a field missing here is silently dropped. */
const pick = (body) => {
    const out = {};
    for (const f of ['type_id', 'title', 'platform', 'stream_url', 'stream_date', 'stream_time',
        'description', 'cover_image', 'is_enabled']) {
        if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f];
    }
    return out;
};

const create = asyncHandler(async (req, res) => {
    const stream = await service.create(req.websiteClient.id, req.params.id, pick(req.body));
    return ApiResponse.created(res, { stream }, 'Live stream added.');
});

const update = asyncHandler(async (req, res) => {
    const stream = await service.update(req.websiteClient.id, req.params.streamId, pick(req.body));
    return ApiResponse.success(res, { stream }, 'Live stream updated.');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.remove(req.websiteClient.id, req.params.streamId);
    return ApiResponse.success(res, result, 'Live stream deleted.');
});

const uploadCover = asyncHandler(async (req, res) => {
    const result = await service.uploadCover(req.websiteClient.id, req.params.id, req.file);
    return ApiResponse.success(res, result, 'Image uploaded.');
});

module.exports = {
    listTypes, createType, updateType, removeType, reorderTypes,
    list, getOne, create, update, remove, uploadCover,
};
