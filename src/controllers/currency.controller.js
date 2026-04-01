const currencyService = require('../services/currency.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get active currencies (public)
 * GET /api/v1/currencies/active
 */
const getActive = asyncHandler(async (req, res) => {
  const currencies = await currencyService.getActive();

  logger.logRequest(req, 'Get active currencies');
  return ApiResponse.success(res, { currencies });
});

/**
 * Get all currencies
 * GET /api/v1/currencies
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await currencyService.getAll(req.query);

  logger.logRequest(req, 'Get all currencies');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get currency by ID
 * GET /api/v1/currencies/:id
 */
const getById = asyncHandler(async (req, res) => {
  const currency = await currencyService.getById(req.params.id);

  logger.logRequest(req, 'Get currency by ID');
  return ApiResponse.success(res, { currency });
});

/**
 * Create new currency
 * POST /api/v1/currencies
 */
const create = asyncHandler(async (req, res) => {
  const currency = await currencyService.create(req.body, req.user.id);

  logger.logRequest(req, 'Create currency');
  return ApiResponse.created(res, { currency }, 'Currency created successfully');
});

/**
 * Update currency
 * PUT /api/v1/currencies/:id
 */
const update = asyncHandler(async (req, res) => {
  const currency = await currencyService.update(req.params.id, req.body, req.user.id);

  logger.logRequest(req, 'Update currency');
  return ApiResponse.success(res, { currency }, 'Currency updated successfully');
});

/**
 * Delete currency
 * DELETE /api/v1/currencies/:id
 */
const remove = asyncHandler(async (req, res) => {
  await currencyService.remove(req.params.id, req.user.id);

  logger.logRequest(req, 'Delete currency');
  return ApiResponse.success(res, null, 'Currency deleted successfully');
});

/**
 * Set default currency
 * PATCH /api/v1/currencies/:id/default
 */
const setDefault = asyncHandler(async (req, res) => {
  const currency = await currencyService.setDefault(req.params.id, req.user.id);

  logger.logRequest(req, 'Set default currency');
  return ApiResponse.success(res, { currency }, 'Default currency updated successfully');
});

module.exports = {
  getActive,
  getAll,
  getById,
  create,
  update,
  delete: remove,
  setDefault,
};
