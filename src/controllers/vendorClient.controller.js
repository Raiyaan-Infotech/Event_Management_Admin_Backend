const vendorClientService = require('../services/vendorClient.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await vendorClientService.getAll(req.query, req.vendor.id);
    ApiResponse.success(res, result, 'Clients retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
    const client = await vendorClientService.getById(req.params.id, req.vendor.id);
    ApiResponse.success(res, client, 'Client retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
    const client = await vendorClientService.create(req.body, req.vendor.id, req.vendor.company_id);
    ApiResponse.success(res, client, 'Client created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const client = await vendorClientService.update(req.params.id, req.body, req.vendor.id);
    ApiResponse.success(res, client, 'Client updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const client = await vendorClientService.updateStatus(req.params.id, req.body.is_active, req.vendor.id);
    ApiResponse.success(res, client, 'Client status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorClientService.remove(req.params.id, req.vendor.id);
    ApiResponse.success(res, null, 'Client deleted successfully');
});

module.exports = { getAll, getById, create, update, updateStatus, remove };
