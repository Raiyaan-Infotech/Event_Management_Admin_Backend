const vendorSubscriberService = require('../services/vendorSubscriber.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await vendorSubscriberService.getAll(req.query, req.vendor.id);
    ApiResponse.success(res, result, 'Subscribers retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
    const subscriber = await vendorSubscriberService.create(req.body, req.vendor.id, req.vendor.company_id);
    ApiResponse.success(res, subscriber, 'Subscriber added successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const subscriber = await vendorSubscriberService.update(req.params.id, req.body, req.vendor.id);
    ApiResponse.success(res, subscriber, 'Subscriber updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorSubscriberService.remove(req.params.id, req.vendor.id);
    ApiResponse.success(res, null, 'Subscriber deleted successfully');
});

module.exports = { getAll, create, update, remove };
