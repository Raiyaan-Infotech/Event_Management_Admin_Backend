const translationService = require('../services/translation.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Get all translation keys (paginated)
 * GET /api/v1/translation-keys
 */
const getAllKeys = asyncHandler(async (req, res) => {
  const result = await translationService.getAllKeys(req.query);

  logger.logRequest(req, 'Get all translation keys');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get translation key by ID
 * GET /api/v1/translation-keys/:id
 */
const getKeyById = asyncHandler(async (req, res) => {
  const key = await translationService.getKeyById(req.params.id);

  logger.logRequest(req, 'Get translation key by ID');
  return ApiResponse.success(res, { key });
});

/**
 * Create translation key
 * POST /api/v1/translation-keys
 */
const createKey = asyncHandler(async (req, res) => {
  const autoTranslate = req.body.auto_translate !== false;
  const key = await translationService.createKey(req.body, req.user.id, autoTranslate);

  logger.logRequest(req, 'Create translation key');
  return ApiResponse.created(res, { key }, 'Translation key created successfully');
});

/**
 * Update translation key
 * PUT /api/v1/translation-keys/:id
 */
const updateKey = asyncHandler(async (req, res) => {
  const key = await translationService.updateKey(req.params.id, req.body, req.user.id);

  logger.logRequest(req, 'Update translation key');
  return ApiResponse.success(res, { key }, 'Translation key updated successfully');
});

/**
 * Delete translation key
 * DELETE /api/v1/translation-keys/:id
 */
const deleteKey = asyncHandler(async (req, res) => {
  await translationService.deleteKey(req.params.id, req.user.id);

  logger.logRequest(req, 'Delete translation key');
  return ApiResponse.success(res, null, 'Translation key deleted successfully');
});

/**
 * Get translations for a key
 * GET /api/v1/translation-keys/:id/translations
 */
const getKeyTranslations = asyncHandler(async (req, res) => {
  const key = await translationService.getKeyById(req.params.id);

  logger.logRequest(req, 'Get translations for key');
  return ApiResponse.success(res, { translations: key.translations });
});

/**
 * Update translations for a key
 * PUT /api/v1/translation-keys/:id/translations
 */
const updateKeyTranslations = asyncHandler(async (req, res) => {
  const { translations } = req.body;
  const result = await translationService.updateTranslations(req.params.id, translations, req.user.id);

  logger.logRequest(req, 'Update translations for key');
  return ApiResponse.success(res, { translations: result }, 'Translations updated successfully');
});

/**
 * Re-translate a key to a specific language
 * POST /api/v1/translation-keys/:id/retranslate
 */
const retranslateKey = asyncHandler(async (req, res) => {
  const { language_id } = req.body;
  const translation = await translationService.retranslateKey(req.params.id, language_id, req.user.id);

  logger.logRequest(req, 'Re-translate key');
  return ApiResponse.success(res, { translation }, 'Translation updated successfully');
});

/**
 * Re-translate a key to all languages
 * POST /api/v1/translation-keys/:id/retranslate-all
 */
const retranslateKeyToAll = asyncHandler(async (req, res) => {
  const translations = await translationService.translateKeyToAllLanguages(req.params.id, req.user.id);

  logger.logRequest(req, 'Re-translate key to all languages');
  return ApiResponse.success(res, { translations }, 'Translations updated successfully');
});

/**
 * Get translations for a language (public - for frontend)
 * GET /api/v1/translations/:langCode
 */
const getTranslationsForLanguage = asyncHandler(async (req, res) => {
  const translations = await translationService.getTranslationsForLanguage(req.params.langCode);

  logger.logRequest(req, 'Get translations for language');
  return ApiResponse.success(res, { translations });
});

/**
 * Get translations for a language by group
 * GET /api/v1/translations/:langCode/:group
 */
const getTranslationsByGroup = asyncHandler(async (req, res) => {
  const translations = await translationService.getTranslationsByGroup(req.params.langCode, req.params.group);

  logger.logRequest(req, 'Get translations by group');
  return ApiResponse.success(res, { translations });
});

/**
 * Translate all keys to a specific language
 * POST /api/v1/translations/translate-all
 */
const translateAllToLanguage = asyncHandler(async (req, res) => {
  const { language_id } = req.body;
  const result = await translationService.translateAllToLanguage(language_id, req.user.id);

  logger.logRequest(req, 'Translate all keys to language');

  const message = result.failed > 0
    ? `${result.created} translations created, ${result.failed} failed`
    : 'Translations created successfully';

  return ApiResponse.success(res, {
    count: result.created,
    failed: result.failed,
    reactivated: result.reactivated
  }, message);
});

/**
 * Get translation statistics
 * GET /api/v1/translations/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const stats = await translationService.getStats();

  logger.logRequest(req, 'Get translation stats');
  return ApiResponse.success(res, { stats });
});

/**
 * Get all translation groups
 * GET /api/v1/translations/groups
 */
const getGroups = asyncHandler(async (req, res) => {
  const groups = await translationService.getGroups();

  logger.logRequest(req, 'Get translation groups');
  return ApiResponse.success(res, { groups });
});

/**
 * Bulk import translation keys
 * POST /api/v1/translation-keys/bulk-import
 */
const bulkImport = asyncHandler(async (req, res) => {
  const { keys, auto_translate = true } = req.body;
  const result = await translationService.bulkImport(keys, req.user.id, auto_translate);

  logger.logRequest(req, 'Bulk import translation keys');
  return ApiResponse.success(res, result, 'Import completed');
});

/**
 * Export all translations
 * GET /api/v1/translations/export
 */
const exportAll = asyncHandler(async (req, res) => {
  const data = await translationService.exportAll();

  logger.logRequest(req, 'Export all translations');
  return ApiResponse.success(res, { data });
});

// ==================== MISSING KEYS ====================

/**
 * Report a missing translation key (public - called from frontend)
 * POST /api/v1/translations/report-missing
 */
const reportMissingKey = asyncHandler(async (req, res) => {
  const { key, default_value, page_url } = req.body;
  const result = await translationService.reportMissingKey(key, default_value, page_url);

  // Don't log every report to avoid spam
  return ApiResponse.success(res, result);
});

/**
 * Get all missing translation keys
 * GET /api/v1/translations/missing
 */
const getMissingKeys = asyncHandler(async (req, res) => {
  const result = await translationService.getMissingKeys(req.query);

  logger.logRequest(req, 'Get missing translation keys');
  return ApiResponse.paginated(res, result.data, result.pagination);
});

/**
 * Get count of missing keys (for dashboard alert)
 * GET /api/v1/translations/missing/count
 */
const getMissingKeysCount = asyncHandler(async (req, res) => {
  const result = await translationService.getMissingKeysCount();

  return ApiResponse.success(res, result);
});

/**
 * Create translation key from a missing key entry
 * POST /api/v1/translations/missing/:id/create
 */
const createKeyFromMissing = asyncHandler(async (req, res) => {
  const key = await translationService.createKeyFromMissing(req.params.id, req.body, req.user.id);

  logger.logRequest(req, 'Create key from missing');
  return ApiResponse.created(res, { key }, 'Translation key created and translated');
});

/**
 * Create all missing keys with auto-translation
 * POST /api/v1/translations/missing/create-all
 */
const createAllMissingKeys = asyncHandler(async (req, res) => {
  const result = await translationService.createAllMissingKeys(req.user.id);

  logger.logRequest(req, 'Create all missing keys');
  return ApiResponse.success(res, result, `Created ${result.created} keys`);
});

/**
 * Delete a missing key entry
 * DELETE /api/v1/translations/missing/:id
 */
const deleteMissingKey = asyncHandler(async (req, res) => {
  await translationService.deleteMissingKey(req.params.id);

  logger.logRequest(req, 'Delete missing key');
  return ApiResponse.success(res, null, 'Missing key deleted');
});

/**
 * Ignore a missing key (mark as resolved without creating)
 * POST /api/v1/translations/missing/:id/ignore
 */
const ignoreMissingKey = asyncHandler(async (req, res) => {
  await translationService.ignoreMissingKey(req.params.id);

  logger.logRequest(req, 'Ignore missing key');
  return ApiResponse.success(res, null, 'Missing key ignored');
});

module.exports = {
  getAllKeys,
  getKeyById,
  createKey,
  updateKey,
  deleteKey,
  getKeyTranslations,
  updateKeyTranslations,
  retranslateKey,
  retranslateKeyToAll,
  getTranslationsForLanguage,
  getTranslationsByGroup,
  translateAllToLanguage,
  getStats,
  getGroups,
  bulkImport,
  exportAll,
  // Missing keys
  reportMissingKey,
  getMissingKeys,
  getMissingKeysCount,
  createKeyFromMissing,
  createAllMissingKeys,
  deleteMissingKey,
  ignoreMissingKey,
};
