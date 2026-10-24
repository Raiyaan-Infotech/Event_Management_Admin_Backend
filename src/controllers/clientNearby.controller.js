const service = require('../services/clientNearby.service');
const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');

/** Near By (2026-10-24) — see clientNearby.service. */

const getSettings = asyncHandler(async (req, res) => {
    const result = await service.getSettings(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, result, 'Near By settings loaded.');
});

const updateSettings = asyncHandler(async (req, res) => {
    const { categories, radius_km, sort } = req.body;
    const result = await service.updateSettings(req.websiteClient.id, req.params.id, { categories, radius_km, sort });
    return ApiResponse.success(res, result, 'Nearby categories saved successfully.');
});

const list = asyncHandler(async (req, res) => {
    const result = await service.list(req.websiteClient.id, req.params.id, req.query);
    return ApiResponse.success(res, result, 'Nearby places loaded.');
});

module.exports = { getSettings, updateSettings, list };
