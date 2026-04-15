const vendorSliderService = require('../services/vendorSlider.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const { logVendorActivity } = require('../middleware/activityLogger');

const getAll = asyncHandler(async (req, res) => {
    const sliders = await vendorSliderService.getAll(req.query, req.vendor.id, req.vendor.company_id);
    ApiResponse.success(res, sliders, 'Sliders retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
    const slider = await vendorSliderService.getById(req.params.id, req.vendor.id);
    ApiResponse.success(res, slider, 'Slider retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
    const slider = await vendorSliderService.create(
        { ...req.body, created_by: req.vendor.id },
        req.vendor.id,
        req.vendor.company_id,
    );
    logVendorActivity(req.vendor.id, 'create_slider', 'vendor_sliders', `Slider "${slider.title}" created`, req);
    ApiResponse.success(res, slider, 'Slider created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const slider = await vendorSliderService.update(
        req.params.id,
        { ...req.body, updated_by: req.vendor.id },
        req.vendor.id,
    );
    logVendorActivity(req.vendor.id, 'update_slider', 'vendor_sliders', `Slider "${slider.title}" updated`, req);
    ApiResponse.success(res, slider, 'Slider updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const slider = await vendorSliderService.updateStatus(req.params.id, req.vendor.id);
    ApiResponse.success(res, slider, 'Slider status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorSliderService.remove(req.params.id, req.vendor.id);
    logVendorActivity(req.vendor.id, 'delete_slider', 'vendor_sliders', `Slider ${req.params.id} deleted`, req);
    ApiResponse.success(res, null, 'Slider deleted successfully');
});

module.exports = { getAll, getById, create, update, updateStatus, remove };
