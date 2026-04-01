const languageService = require('../services/language.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get active languages (public)
 * GET /api/v1/languages/active
 */
const getActive = asyncHandler(async (req, res) => {
  const languages = await languageService.getActive();

  logger.logRequest(req, 'Get active languages');
  return ApiResponse.success(res, { languages });
});

/**
 * Get all languages
 * GET /api/v1/languages
 */
const getAll = asyncHandler(async (req, res) => {
  const result = await languageService.getAll(req.query);

  logger.logRequest(req, 'Get all languages');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get language by ID
 * GET /api/v1/languages/:id
 */
const getById = asyncHandler(async (req, res) => {
  const language = await languageService.getById(req.params.id);

  logger.logRequest(req, 'Get language by ID');
  return ApiResponse.success(res, { language });
});

/**
 * Create new language
 * POST /api/v1/languages
 */
const create = asyncHandler(async (req, res) => {
  const language = await languageService.create(req.body, req.user.id);

  logger.logRequest(req, 'Create language');
  return ApiResponse.created(res, { language }, 'Language created successfully');
});

/**
 * Update language
 * PUT /api/v1/languages/:id
 */
const update = asyncHandler(async (req, res) => {
  const language = await languageService.update(req.params.id, req.body, req.user.id);

  logger.logRequest(req, 'Update language');
  return ApiResponse.success(res, { language }, 'Language updated successfully');
});

/**
 * Delete language
 * DELETE /api/v1/languages/:id
 */
const remove = asyncHandler(async (req, res) => {
  await languageService.remove(req.params.id, req.user.id);

  logger.logRequest(req, 'Delete language');
  return ApiResponse.success(res, null, 'Language deleted successfully');
});

/**
 * Set default language
 * PATCH /api/v1/languages/:id/default
 */
const setDefault = asyncHandler(async (req, res) => {
  const language = await languageService.setDefault(req.params.id, req.user.id);

  logger.logRequest(req, 'Set default language');
  return ApiResponse.success(res, { language }, 'Default language updated successfully');
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
