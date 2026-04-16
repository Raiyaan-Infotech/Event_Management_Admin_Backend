const vendorGalleryService = require('../services/vendorGallery.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const { logVendorActivity } = require('../middleware/activityLogger');

const getAll = asyncHandler(async (req, res) => {
    const items = await vendorGalleryService.getAll(req.vendor.id);
    ApiResponse.success(res, items, 'Gallery items retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
    const item = await vendorGalleryService.getById(req.params.id, req.vendor.id);
    ApiResponse.success(res, item, 'Gallery item retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
    const { event_name, city, images, img_view, is_active } = req.body;
    const item = await vendorGalleryService.create(
        { event_name, city, images, img_view, is_active, created_by: req.vendor.id },
        req.vendor.id,
        req.vendor.company_id,
    );
    logVendorActivity(req.vendor.id, 'create_gallery', 'vendor_gallery', `Gallery item added`, req);
    ApiResponse.success(res, item, 'Gallery item created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const { event_name, city, images, img_view, is_active } = req.body;
    const item = await vendorGalleryService.update(
        req.params.id,
        { event_name, city, images, img_view, is_active },
        req.vendor.id,
    );
    logVendorActivity(req.vendor.id, 'update_gallery', 'vendor_gallery', `Gallery item ${req.params.id} updated`, req);
    ApiResponse.success(res, item, 'Gallery item updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const item = await vendorGalleryService.updateStatus(req.params.id, req.vendor.id);
    ApiResponse.success(res, item, 'Status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorGalleryService.remove(req.params.id, req.vendor.id);
    logVendorActivity(req.vendor.id, 'delete_gallery', 'vendor_gallery', `Gallery item ${req.params.id} deleted`, req);
    ApiResponse.success(res, null, 'Gallery item deleted successfully');
});

module.exports = { getAll, getById, create, update, updateStatus, remove };