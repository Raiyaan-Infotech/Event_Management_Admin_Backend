const service = require('../services/clientSocialLink.service');
const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');

/** Every editable field, destructured — a field missing here is silently dropped. */
const pick = (body) => {
    const out = {};
    for (const f of ['platform_name', 'title', 'url', 'description', 'icon_url',
        'open_external', 'show_in_app', 'position']) {
        if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f];
    }
    return out;
};

const list = asyncHandler(async (req, res) => {
    const result = await service.list(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Social links loaded.');
});

const getOne = asyncHandler(async (req, res) => {
    const result = await service.getOne(req.websiteClient.id, req.params.linkId);
    return ApiResponse.success(res, result, 'Social link loaded.');
});

const create = asyncHandler(async (req, res) => {
    const link = await service.create(req.websiteClient.id, req.params.id, pick(req.body));
    return ApiResponse.created(res, { link }, 'Social link added.');
});

const update = asyncHandler(async (req, res) => {
    const link = await service.update(req.websiteClient.id, req.params.linkId, pick(req.body));
    return ApiResponse.success(res, { link }, 'Social link updated.');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.remove(req.websiteClient.id, req.params.linkId);
    return ApiResponse.success(res, result, result.cleared ? 'Social link cleared.' : 'Social link deleted.');
});

const reorder = asyncHandler(async (req, res) => {
    const result = await service.reorder(req.websiteClient.id, req.params.id, { ids: req.body.ids });
    return ApiResponse.success(res, result, 'Social link order saved.');
});

const uploadIcon = asyncHandler(async (req, res) => {
    const result = await service.uploadIcon(req.websiteClient.id, req.params.id, req.file);
    return ApiResponse.success(res, result, 'Icon uploaded.');
});

module.exports = { list, getOne, create, update, remove, reorder, uploadIcon };
