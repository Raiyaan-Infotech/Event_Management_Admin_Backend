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

const remove = asyncHandler(async (req, res) => {
    const result = await service.removeItem(req.websiteClient.id, req.params.itemId);
    return ApiResponse.success(res, result, 'Removed.');
});

module.exports = { list, usage, upload, remove };
