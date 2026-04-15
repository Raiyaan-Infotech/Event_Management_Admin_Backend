const vendorPortfolioItemService = require('../services/vendorPortfolioItem.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const { logVendorActivity } = require('../middleware/activityLogger');

// type is injected by the route wrapper
const makeController = (type) => ({

    getAll: asyncHandler(async (req, res) => {
        const items = await vendorPortfolioItemService.getAll(type, req.vendor.id);
        ApiResponse.success(res, items, `${type}s retrieved successfully`);
    }),

    getById: asyncHandler(async (req, res) => {
        const item = await vendorPortfolioItemService.getById(req.params.id, req.vendor.id);
        ApiResponse.success(res, item, `${type} retrieved successfully`);
    }),

    create: asyncHandler(async (req, res) => {
        const item = await vendorPortfolioItemService.create(
            type,
            { image_path: req.body.image_path, created_by: req.vendor.id },
            req.vendor.id,
            req.vendor.company_id,
        );
        logVendorActivity(req.vendor.id, `create_portfolio_${type}`, 'vendor_portfolio_items', `Portfolio ${type} added`, req);
        ApiResponse.success(res, item, `${type} added successfully`, 201);
    }),

    update: asyncHandler(async (req, res) => {
        const item = await vendorPortfolioItemService.update(
            req.params.id,
            { image_path: req.body.image_path },
            req.vendor.id,
        );
        logVendorActivity(req.vendor.id, `update_portfolio_${type}`, 'vendor_portfolio_items', `Portfolio ${type} ${req.params.id} updated`, req);
        ApiResponse.success(res, item, `${type} updated successfully`);
    }),

    updateStatus: asyncHandler(async (req, res) => {
        const item = await vendorPortfolioItemService.updateStatus(req.params.id, req.vendor.id);
        ApiResponse.success(res, item, 'Status updated successfully');
    }),

    remove: asyncHandler(async (req, res) => {
        await vendorPortfolioItemService.remove(req.params.id, req.vendor.id);
        logVendorActivity(req.vendor.id, `delete_portfolio_${type}`, 'vendor_portfolio_items', `Portfolio ${type} ${req.params.id} deleted`, req);
        ApiResponse.success(res, null, `${type} deleted successfully`);
    }),
});

// Events: separate handlers (not logo-based, so no factory)
const getEvents = asyncHandler(async (req, res) => {
    const items = await vendorPortfolioItemService.getEvents(req.vendor.id);
    ApiResponse.success(res, items, 'Events retrieved successfully');
});

const replaceEvents = asyncHandler(async (req, res) => {
    const items = await vendorPortfolioItemService.replaceEvents(
        req.body.items || [],
        req.vendor.id,
        req.vendor.company_id,
        req.vendor.id,
    );
    logVendorActivity(req.vendor.id, 'update_portfolio_events', 'vendor_portfolio_items', 'Portfolio events updated', req);
    ApiResponse.success(res, items, 'Events saved successfully');
});

module.exports = { makeController, getEvents, replaceEvents };
