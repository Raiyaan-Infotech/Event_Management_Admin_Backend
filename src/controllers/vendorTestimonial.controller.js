const vendorTestimonialService = require('../services/vendorTestimonial.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const { logVendorActivity } = require('../middleware/activityLogger');

const getAll = asyncHandler(async (req, res) => {
    const items = await vendorTestimonialService.getAll(req.vendor.id);
    ApiResponse.success(res, items, 'Testimonials retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
    const item = await vendorTestimonialService.getById(req.params.id, req.vendor.id);
    ApiResponse.success(res, item, 'Testimonial retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
    const { customer_name, customer_portrait, event_name, client_feedback, is_active } = req.body;
    const item = await vendorTestimonialService.create(
        { customer_name, customer_portrait, event_name, client_feedback, is_active, created_by: req.vendor.id },
        req.vendor.id,
        req.vendor.company_id,
    );
    logVendorActivity(req.vendor.id, 'create_testimonial', 'vendor_testimonials', `Testimonial added`, req);
    ApiResponse.success(res, item, 'Testimonial created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const { customer_name, customer_portrait, event_name, client_feedback, is_active } = req.body;
    const item = await vendorTestimonialService.update(
        req.params.id,
        { customer_name, customer_portrait, event_name, client_feedback, is_active },
        req.vendor.id,
    );
    logVendorActivity(req.vendor.id, 'update_testimonial', 'vendor_testimonials', `Testimonial ${req.params.id} updated`, req);
    ApiResponse.success(res, item, 'Testimonial updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const item = await vendorTestimonialService.updateStatus(req.params.id, req.vendor.id);
    ApiResponse.success(res, item, 'Status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorTestimonialService.remove(req.params.id, req.vendor.id);
    logVendorActivity(req.vendor.id, 'delete_testimonial', 'vendor_testimonials', `Testimonial ${req.params.id} deleted`, req);
    ApiResponse.success(res, null, 'Testimonial deleted successfully');
});

module.exports = { getAll, getById, create, update, updateStatus, remove };