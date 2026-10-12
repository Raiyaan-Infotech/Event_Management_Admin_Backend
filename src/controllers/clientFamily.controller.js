const service = require('../services/clientFamily.service');
const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');

const list = asyncHandler(async (req, res) => {
    const result = await service.list(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Family loaded.');
});

const getOne = asyncHandler(async (req, res) => {
    const member = await service.getOne(req.websiteClient.id, req.params.memberId);
    return ApiResponse.success(res, { member }, 'Family member loaded.');
});

const create = asyncHandler(async (req, res) => {
    const member = await service.create(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.created(res, { member }, 'Family member added.');
});

const update = asyncHandler(async (req, res) => {
    const member = await service.update(req.websiteClient.id, req.params.memberId, req.body);
    return ApiResponse.success(res, { member }, 'Family member updated.');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.remove(req.websiteClient.id, req.params.memberId);
    return ApiResponse.success(res, result, 'Family member deleted.');
});

const reorder = asyncHandler(async (req, res) => {
    const result = await service.reorder(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.success(res, result, 'Family order saved.');
});

const getSettings = asyncHandler(async (req, res) => {
    const result = await service.getSettings(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Family settings loaded.');
});

const updateSettings = asyncHandler(async (req, res) => {
    const result = await service.updateSettings(req.websiteClient.id, req.params.id, req.body);
    return ApiResponse.success(res, result, 'Family settings saved.');
});

module.exports = { list, getOne, create, update, remove, reorder, getSettings, updateSettings };
