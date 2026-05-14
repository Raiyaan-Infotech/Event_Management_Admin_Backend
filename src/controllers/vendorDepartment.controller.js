const vendorDepartmentService = require('../services/vendorDepartment.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await vendorDepartmentService.getAll(req.query, req.vendor.id);
    logger.logRequest(req, 'Vendor: Get all departments');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const dept = await vendorDepartmentService.getById(req.params.id, req.vendor.id);
    logger.logRequest(req, 'Vendor: Get department by ID');
    return ApiResponse.success(res, { department: dept });
});

const create = asyncHandler(async (req, res) => {
    const dept = await vendorDepartmentService.create(req.body, req.vendor.id, req.vendor.company_id);
    logger.logRequest(req, 'Vendor: Create department');
    return ApiResponse.created(res, { department: dept }, 'Department created successfully');
});

const update = asyncHandler(async (req, res) => {
    const dept = await vendorDepartmentService.update(req.params.id, req.body, req.vendor.id);
    logger.logRequest(req, 'Vendor: Update department');
    return ApiResponse.success(res, { department: dept }, 'Department updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorDepartmentService.remove(req.params.id, req.vendor.id);
    logger.logRequest(req, 'Vendor: Delete department');
    return ApiResponse.success(res, null, 'Department deleted successfully');
});

module.exports = { getAll, getById, create, update, delete: remove };
