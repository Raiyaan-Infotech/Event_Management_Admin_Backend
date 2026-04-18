const vendorEmailTemplateService = require('../services/vendorEmailTemplate.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
  const result = await vendorEmailTemplateService.getAll(req.vendor.id, req.query);
  logger.logRequest(req, 'Vendor: get all email templates');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

const getById = asyncHandler(async (req, res) => {
  const template = await vendorEmailTemplateService.getById(req.params.id, req.vendor.id);
  logger.logRequest(req, 'Vendor: get email template by ID');
  return ApiResponse.success(res, { template });
});

const create = asyncHandler(async (req, res) => {
  const { name, category_id, description, is_active } = req.body;
  const template = await vendorEmailTemplateService.create(
    { name, category_id, description, is_active },
    req.vendor.id,
    req.vendor.company_id,
    req.vendor.id
  );
  logger.logRequest(req, 'Vendor: create email template');
  return ApiResponse.created(res, { template }, 'Email template created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { name, category_id, description, is_active } = req.body;
  const template = await vendorEmailTemplateService.update(
    req.params.id,
    { name, category_id, description, is_active },
    req.vendor.id,
    req.vendor.id
  );
  logger.logRequest(req, 'Vendor: update email template');
  return ApiResponse.success(res, { template }, 'Email template updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
  const template = await vendorEmailTemplateService.updateStatus(
    req.params.id,
    req.vendor.id,
    req.vendor.id
  );
  logger.logRequest(req, 'Vendor: toggle email template status');
  return ApiResponse.success(res, { template }, 'Status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await vendorEmailTemplateService.remove(req.params.id, req.vendor.id, req.vendor.id);
  logger.logRequest(req, 'Vendor: delete email template');
  return ApiResponse.success(res, null, 'Email template deleted successfully');
});

module.exports = { getAll, getById, create, update, updateStatus, delete: remove };
