const vendorPageService = require('../services/vendorPage.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const { logVendorActivity } = require('../middleware/activityLogger');

const getAll = asyncHandler(async (req, res) => {
    const pages = await vendorPageService.getAll(req.query, req.vendor.id, req.vendor.company_id);
    ApiResponse.success(res, pages, 'Pages retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
    const page = await vendorPageService.getById(req.params.id, req.vendor.id, req.vendor.company_id);
    ApiResponse.success(res, page, 'Page retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
    const page = await vendorPageService.create(
        { ...req.body, created_by: req.vendor.id },
        req.vendor.id,
        req.vendor.company_id,
    );
    logVendorActivity(req.vendor.id, 'create_page', 'vendor_pages', `Page "${page.name}" created`, req);
    ApiResponse.success(res, page, 'Page created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const page = await vendorPageService.update(
        req.params.id,
        { ...req.body, updated_by: req.vendor.id },
        req.vendor.id,
        req.vendor.company_id,
    );
    logVendorActivity(req.vendor.id, 'update_page', 'vendor_pages', `Page "${page.name}" updated`, req);
    ApiResponse.success(res, page, 'Page updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const page = await vendorPageService.updateStatus(req.params.id, req.body.status, req.vendor.id);
    ApiResponse.success(res, page, 'Page status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorPageService.remove(req.params.id, req.vendor.id);
    logVendorActivity(req.vendor.id, 'delete_page', 'vendor_pages', `Page ${req.params.id} deleted`, req);
    ApiResponse.success(res, null, 'Page deleted successfully');
});

module.exports = { getAll, getById, create, update, updateStatus, remove };