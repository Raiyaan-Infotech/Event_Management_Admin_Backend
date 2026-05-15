const departmentService = require('../services/department.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await departmentService.getAll(req.query, req.companyId);
    logger.logRequest(req, 'Get all departments');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
    const dept = await departmentService.getById(req.params.id, req.companyId);
    logger.logRequest(req, 'Get department by ID');
    return ApiResponse.success(res, { department: dept });
});

const create = asyncHandler(async (req, res) => {
    const dept = await departmentService.create(req.body, req.companyId);
    logger.logRequest(req, 'Create department');
    return ApiResponse.created(res, { department: dept }, 'Department created successfully');
});

const update = asyncHandler(async (req, res) => {
    const dept = await departmentService.update(req.params.id, req.body, req.companyId);
    logger.logRequest(req, 'Update department');
    return ApiResponse.success(res, { department: dept }, 'Department updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await departmentService.remove(req.params.id, req.companyId);
    logger.logRequest(req, 'Delete department');
    return ApiResponse.success(res, null, 'Department deleted successfully');
});

module.exports = { getAll, getById, create, update, delete: remove };
