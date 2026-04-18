const vendorEmailCategoryService = require('../services/vendorEmailCategory.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
  const result = await vendorEmailCategoryService.getAll(req.vendor.id, req.query);
  logger.logRequest(req, 'Vendor: get all email categories');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
  const category = await vendorEmailCategoryService.getById(req.params.id, req.vendor.id);
  logger.logRequest(req, 'Vendor: get email category by ID');
  return ApiResponse.success(res, { category });
});

const create = asyncHandler(async (req, res) => {
  const { name, description, sort_order, is_active } = req.body;
  const category = await vendorEmailCategoryService.create(
    { name, description, sort_order, is_active },
    req.vendor.id,
    req.vendor.company_id,
    req.vendor.id
  );
  logger.logRequest(req, 'Vendor: create email category');
  return ApiResponse.created(res, { category }, 'Email category created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { name, description, sort_order, is_active } = req.body;
  const category = await vendorEmailCategoryService.update(
    req.params.id,
    { name, description, sort_order, is_active },
    req.vendor.id,
    req.vendor.id
  );
  logger.logRequest(req, 'Vendor: update email category');
  return ApiResponse.success(res, { category }, 'Email category updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await vendorEmailCategoryService.remove(req.params.id, req.vendor.id, req.vendor.id);
  logger.logRequest(req, 'Vendor: delete email category');
  return ApiResponse.success(res, null, 'Email category deleted successfully');
});

module.exports = { getAll, getById, create, update, delete: remove };
