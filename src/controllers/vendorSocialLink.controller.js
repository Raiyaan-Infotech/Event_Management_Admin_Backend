const vendorSocialLinkService = require('../services/vendorSocialLink.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const links = await vendorSocialLinkService.getAll(req.vendor.id);
    ApiResponse.success(res, links, 'Social links retrieved');
});

const getById = asyncHandler(async (req, res) => {
    const link = await vendorSocialLinkService.getById(req.vendor.id, req.params.id);
    ApiResponse.success(res, link, 'Social link retrieved');
});

const create = asyncHandler(async (req, res) => {
    const { icon, icon_color, label, url, is_active, sort_order } = req.body;
    const link = await vendorSocialLinkService.create(req.vendor.id, {
        icon, icon_color, label, url, is_active, sort_order,
    });
    ApiResponse.success(res, link, 'Social link created', 201);
});

const update = asyncHandler(async (req, res) => {
    const { icon, icon_color, label, url, is_active, sort_order } = req.body;
    const link = await vendorSocialLinkService.update(req.vendor.id, req.params.id, {
        icon, icon_color, label, url, is_active, sort_order,
    });
    ApiResponse.success(res, link, 'Social link updated');
});

const toggleActive = asyncHandler(async (req, res) => {
    const link = await vendorSocialLinkService.toggleActive(req.vendor.id, req.params.id);
    ApiResponse.success(res, link, 'Social link toggled');
});

const remove = asyncHandler(async (req, res) => {
    await vendorSocialLinkService.remove(req.vendor.id, req.params.id);
    ApiResponse.success(res, null, 'Social link deleted');
});

// ─── Admin-scoped methods (uses req.params.vendorId instead of req.vendor.id) ──

const getAllByVendor = asyncHandler(async (req, res) => {
    const links = await vendorSocialLinkService.getAll(req.params.vendorId);
    ApiResponse.success(res, links, 'Social links retrieved');
});

const createForVendor = asyncHandler(async (req, res) => {
    const { icon, icon_color, label, url, is_active, sort_order } = req.body;
    const link = await vendorSocialLinkService.create(req.params.vendorId, {
        icon, icon_color, label, url, is_active, sort_order,
    });
    ApiResponse.success(res, link, 'Social link created', 201);
});

const updateForVendor = asyncHandler(async (req, res) => {
    const { icon, icon_color, label, url, is_active, sort_order } = req.body;
    const link = await vendorSocialLinkService.update(req.params.vendorId, req.params.id, {
        icon, icon_color, label, url, is_active, sort_order,
    });
    ApiResponse.success(res, link, 'Social link updated');
});

const deleteForVendor = asyncHandler(async (req, res) => {
    await vendorSocialLinkService.remove(req.params.vendorId, req.params.id);
    ApiResponse.success(res, null, 'Social link deleted');
});

module.exports = { getAll, getById, create, update, toggleActive, remove, getAllByVendor, createForVendor, updateForVendor, deleteForVendor };
