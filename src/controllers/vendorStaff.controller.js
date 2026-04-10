const vendorStaffService = require('../services/vendorStaff.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await vendorStaffService.getAll(req.query, req.vendor.id);
    ApiResponse.success(res, result, 'Staff retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
    const staff = await vendorStaffService.getById(req.params.id, req.vendor.id);
    ApiResponse.success(res, staff, 'Staff member retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
    const staff = await vendorStaffService.create(req.body, req.vendor.id, req.vendor.company_id);
    ApiResponse.success(res, staff, 'Staff member created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const staff = await vendorStaffService.update(req.params.id, req.body, req.vendor.id);
    ApiResponse.success(res, staff, 'Staff member updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const staff = await vendorStaffService.updateStatus(req.params.id, req.body.is_active, req.vendor.id);
    ApiResponse.success(res, staff, 'Staff status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorStaffService.remove(req.params.id, req.vendor.id);
    ApiResponse.success(res, null, 'Staff member deleted successfully');
});

const reassignStaffRole = asyncHandler(async (req, res) => {
    const staff = await vendorStaffService.reassignRole(req.params.id, req.body.role_id, req.vendor.id);
    ApiResponse.success(res, { staff }, 'Staff role updated successfully');
});

module.exports = { getAll, getById, create, update, updateStatus, remove, reassignStaffRole };
