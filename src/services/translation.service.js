const { TranslationKey, Translation, Language, MissingTranslationKey } = require('../models');
const baseService = require('./base.service');
const autoTranslateService = require('./autoTranslate.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const { Op } = require('sequelize');

const MODEL_NAME = 'TranslationKey';
const TRANSLATION_MODEL_NAME = 'Translation';

/**
 * Get all translation keys with pagination
 */
const getAllKeys = async (query = {}) => {
  const options = {
    searchFields: ['key', 'default_value', 'description'],
    sortableFields: ['created_at', 'key', 'group'],
    include: [
      {
        model: Translation,
        as: 'translations',
        where: { is_active: true },
        required: false, // LEFT JOIN - still show keys without translations
        include: [
          {
            model: Language,
            as: 'language',
            attributes: ['id', 'code', 'name'],
          },
        ],
      },
    ],
  };

  // Filter by group
  if (query.group) {
    options.where = { group: query.group };
  }

  options.moduleSlug = 'translations';
  return baseService.getAll(TranslationKey, MODEL_NAME, query, options);
};

/**
 * Get translation key by ID with all translations
 */
const getKeyById = async (id) => {
  try {
    const key = await TranslationKey.findByPk(id, {
      include: [
        {
          model: Translation,
          as: 'translations',
          where: { is_active: true },
          required: false,
          include: [
            {
              model: Language,
              as: 'language',
              attributes: ['id', 'code', 'name'],
            },
          ],
        },
      ],
    });

    if (!key) {
      throw ApiError.notFound('Translation key not found');
    }

    logger.logDB('findById', MODEL_NAME, id);
    return key;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create translation key and auto-translate to all active languages
 */
const createKey = async (data, userId = null, autoTranslate = true) => {
  try {
    // Check if key already exists
    const existing = await TranslationKey.findOne({ where: { key: data.key } });
    if (existing) {
      throw ApiError.conflict('Translation key already exists');
    }

    // Create the key
    const translationKey = await baseService.create(TranslationKey, MODEL_NAME, data, userId);

    // Auto-translate to all active languages
    if (autoTranslate) {
      await translateKeyToAllLanguages(translationKey.id, userId);
    }

    // Reload with translations
    return getKeyById(translationKey.id);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update translation key
 */
const updateKey = async (id, data, userId = null) => {
  try {
    const key = await TranslationKey.findByPk(id);
    if (!key) {
      throw ApiError.notFound('Translation key not found');
    }

    // Check key uniqueness
    if (data.key && data.key !== key.key) {
      const existing = await TranslationKey.findOne({ where: { key: data.key } });
      if (existing) {
        throw ApiError.conflict('Translation key already exists');
      }
    }

    return baseService.update(TranslationKey, MODEL_NAME, id, data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete translation key and all its translations
 */
const deleteKey = async (id, userId = null) => {
  try {
    const key = await TranslationKey.findByPk(id);
    if (!key) {
      throw ApiError.notFound('Translation key not found');
    }

    // Delete all translations for this key
    await Translation.destroy({ where: { translation_key_id: id } });

    return baseService.remove(TranslationKey, MODEL_NAME, id, userId, undefined, { uniqueFields: ['key'] });
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get or create translation for a specific key and language
 */
const getOrCreateTranslation = async (translationKeyId, languageId, userId = null) => {
  try {
    let translation = await Translation.findOne({
      where: {
        translation_key_id: translationKeyId,
        language_id: languageId,
      },
    });

    if (!translation) {
      const key = await TranslationKey.findByPk(translationKeyId);
      const language = await Language.findByPk(languageId);

      if (!key || !language) {
        throw ApiError.notFound('Translation key or language not found');
      }

      // Auto-translate
      const translatedText = await autoTranslateService.translateText(
        key.default_value,
        'en',
        language.code
      );

      translation = await Translation.create({
        translation_key_id: translationKeyId,
        language_id: languageId,
        value: translatedText,
        status: 'auto',
        created_by: userId,
      });
    }

    return translation;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update translation value
 */
const updateTranslation = async (translationKeyId, languageId, value, userId = null) => {
  try {
    let translation = await Translation.findOne({
      where: {
        translation_key_id: translationKeyId,
        language_id: languageId,
      },
    });

    if (translation) {
      await translation.update({
        value,
        status: 'reviewed',
        updated_by: userId,
      });
    } else {
      translation = await Translation.create({
        translation_key_id: translationKeyId,
        language_id: languageId,
        value,
        status: 'reviewed',
        created_by: userId,
      });
    }

    logger.logDB('updateTranslation', TRANSLATION_MODEL_NAME, translation.id);
    return translation;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update multiple translations for a key
 */
const updateTranslations = async (translationKeyId, translations, userId = null) => {
  try {
    const key = await TranslationKey.findByPk(translationKeyId);
    if (!key) {
      throw ApiError.notFound('Translation key not found');
    }

    const results = [];
    for (const { language_id, value } of translations) {
      const translation = await updateTranslation(translationKeyId, language_id, value, userId);
      results.push(translation);
    }

    return results;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Translate a key to all active languages
 */
const translateKeyToAllLanguages = async (translationKeyId, userId = null) => {
  try {
    const key = await TranslationKey.findByPk(translationKeyId);
    if (!key) {
      throw ApiError.notFound('Translation key not found');
    }

    const languages = await Language.findAll({
      where: { is_active: true },
    });

    const results = [];
    for (const language of languages) {
      // Check if translation already exists
      let translation = await Translation.findOne({
        where: {
          translation_key_id: translationKeyId,
          language_id: language.id,
        },
      });

      if (!translation) {
        // Auto-translate
        const translatedText = await autoTranslateService.translateText(
          key.default_value,
          'en',
          language.code
        );

        translation = await Translation.create({
          translation_key_id: translationKeyId,
          language_id: language.id,
          value: translatedText,
          status: 'auto',
          created_by: userId,
        });
      }

      results.push(translation);
    }

    logger.logDB('translateKeyToAllLanguages', MODEL_NAME, translationKeyId);
    return results;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Re-translate a key to a specific language
 */
const retranslateKey = async (translationKeyId, languageId, userId = null) => {
  try {
    const key = await TranslationKey.findByPk(translationKeyId);
    if (!key) {
      throw ApiError.notFound('Translation key not found');
    }

    const language = await Language.findByPk(languageId);
    if (!language) {
      throw ApiError.notFound('Language not found');
    }

    // Auto-translate
    const translatedText = await autoTranslateService.translateText(
      key.default_value,
      'en',
      language.code
    );

    // Update or create translation
    let translation = await Translation.findOne({
      where: {
        translation_key_id: translationKeyId,
        language_id: languageId,
      },
    });

    if (translation) {
      await translation.update({
        value: translatedText,
        status: 'auto',
        updated_by: userId,
      });
    } else {
      translation = await Translation.create({
        translation_key_id: translationKeyId,
        language_id: languageId,
        value: translatedText,
        status: 'auto',
        created_by: userId,
      });
    }

    logger.logDB('retranslateKey', MODEL_NAME, translationKeyId);
    return translation;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Helper function to translate with retry logic for rate limits
 * Does NOT retry on quota exceeded (daily limit) - only temporary rate limits
 */
const translateWithRetry = async (text, sourceLang, targetLang, maxRetries = 2) => {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await autoTranslateService.translateText(text, sourceLang, targetLang);
    } catch (error) {
      lastError = error;

      // Check for daily quota exceeded - don't retry
      if (error.message?.includes('quota') || error.message?.includes('QUOTA')) {
        logger.logError(error, 'Daily quota exceeded - stopping retries');
        throw error;
      }

      const statusCode = error.response?.status || error.statusCode;

      // Only retry on temporary rate limit (429) - with max 2 attempts
      if (statusCode === 429 && attempt < maxRetries) {
        const delay = attempt * 2000; // 2s, 4s
        logger.logError(error, `Rate limited, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Non-retryable error or max retries reached
        throw error;
      }
    }
  }
  throw lastError;
};

// Circuit breaker state
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Translate all keys to a specific language (for when new language is added)
 * Optimized with batch processing for 300+ records
 * Also handles reactivation of previously deactivated translations
 * Includes retry logic for rate limits and reports failed translations
 */
const translateAllToLanguage = async (languageId, userId = null) => {
  try {
    const language = await Language.findByPk(languageId);
    if (!language) {
      throw ApiError.notFound('Language not found');
    }

    // Get all keys
    const keys = await TranslationKey.findAll();

    // Get ALL existing translations for this language (including inactive)
    const existingTranslations = await Translation.findAll({
      where: { language_id: languageId },
      attributes: ['id', 'translation_key_id', 'is_active'],
    });

    // Separate into active and inactive
    const activeKeyIds = new Set();
    const inactiveTranslations = [];

    existingTranslations.forEach(t => {
      if (t.is_active) {
        activeKeyIds.add(t.translation_key_id);
      } else {
        inactiveTranslations.push(t);
      }
    });

    // Reactivate inactive translations
    if (inactiveTranslations.length > 0) {
      const inactiveIds = inactiveTranslations.map(t => t.id);
      await Translation.update(
        { is_active: true, updated_by: userId },
        { where: { id: inactiveIds } }
      );
      logger.logDB('reactivateTranslations', 'Translation', languageId, { count: inactiveTranslations.length });
    }

    // Get keys that have no translation at all (neither active nor inactive)
    const existingKeyIds = new Set(existingTranslations.map(t => t.translation_key_id));
    const keysToTranslate = keys.filter(key => !existingKeyIds.has(key.id));

    if (keysToTranslate.length === 0) {
      logger.logDB('translateAllToLanguage', 'Language', languageId, {
        created: 0,
        failed: 0,
        reactivated: inactiveTranslations.length,
        message: 'All keys already have translations'
      });
      return { created: 0, failed: 0, reactivated: inactiveTranslations.length };
    }

    // Aggressive batch processing with parallel translations
    const BATCH_SIZE = 10; // Process 10 at a time
    const PARALLEL_LIMIT = 5; // 5 parallel API calls
    const results = [];
    let failedCount = 0;
    const failedKeys = [];

    // Reset circuit breaker at start
    consecutiveFailures = 0;

    for (let i = 0; i < keysToTranslate.length; i += BATCH_SIZE) {
      // Circuit breaker: stop if too many consecutive failures (quota likely exceeded)
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        logger.logError(new Error('Circuit breaker triggered'), `Stopping translation after ${MAX_CONSECUTIVE_FAILURES} consecutive failures - API quota likely exceeded`);
        break;
      }

      const batch = keysToTranslate.slice(i, i + BATCH_SIZE);

      // Process batch in parallel chunks
      for (let j = 0; j < batch.length; j += PARALLEL_LIMIT) {
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;

        const parallelChunk = batch.slice(j, j + PARALLEL_LIMIT);

        // Translate in parallel
        const translationPromises = parallelChunk.map(async (key) => {
          try {
            const translatedText = await translateWithRetry(
              key.default_value,
              'en',
              language.code
            );
            return { success: true, key, translatedText };
          } catch (error) {
            return { success: false, key, error };
          }
        });

        const chunkResults = await Promise.all(translationPromises);

        // Bulk insert successful translations
        const successfulTranslations = chunkResults
          .filter(r => r.success)
          .map(r => ({
            translation_key_id: r.key.id,
            language_id: languageId,
            value: r.translatedText,
            status: 'auto',
            is_active: true,
            created_by: userId,
          }));

        if (successfulTranslations.length > 0) {
          const created = await Translation.bulkCreate(successfulTranslations, {
            ignoreDuplicates: true,
          });
          results.push(...created);
          consecutiveFailures = 0; // Reset on any success
        }

        // Count failures
        chunkResults.filter(r => !r.success).forEach(r => {
          logger.logError(r.error, `Failed to translate key ${r.key.id}`);
          failedCount++;
          failedKeys.push({ id: r.key.id, key: r.key.key });
          consecutiveFailures++;
        });

        // Small delay between parallel chunks (100ms)
        if (j + PARALLEL_LIMIT < batch.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Delay between batches (300ms)
      if (i + BATCH_SIZE < keysToTranslate.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Calculate skipped keys (if circuit breaker triggered)
    const processedCount = results.length + failedCount;
    const skippedCount = keysToTranslate.length - processedCount;
    const quotaExceeded = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;

    logger.logDB('translateAllToLanguage', 'Language', languageId, {
      created: results.length,
      failed: failedCount,
      skipped: skippedCount,
      reactivated: inactiveTranslations.length,
      quotaExceeded,
      failedKeys: failedKeys.length > 0 ? failedKeys.slice(0, 10) : undefined
    });

    return {
      created: results.length,
      failed: failedCount + skippedCount, // Include skipped as failed
      reactivated: inactiveTranslations.length,
      quotaExceeded
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get all translations for a specific language (for frontend)
 */
const getTranslationsForLanguage = async (langCode) => {
  try {
    const language = await Language.findOne({ where: { code: langCode } });
    if (!language) {
      throw ApiError.notFound('Language not found');
    }

    const translations = await Translation.findAll({
      where: { language_id: language.id, is_active: true },
      include: [
        {
          model: TranslationKey,
          as: 'translation_key',
          attributes: ['key', 'default_value', 'group'],
        },
      ],
    });

    // Convert to key-value object for easy frontend usage
    const translationMap = {};
    translations.forEach(t => {
      if (t.translation_key) {
        translationMap[t.translation_key.key] = t.value;
      }
    });

    // Also include default values for any missing translations
    const allKeys = await TranslationKey.findAll();
    allKeys.forEach(key => {
      if (!translationMap[key.key]) {
        translationMap[key.key] = key.default_value;
      }
    });

    logger.logDB('getTranslationsForLanguage', 'Translation', null, { langCode });
    return translationMap;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get translations for a specific language and group
 */
const getTranslationsByGroup = async (langCode, group) => {
  try {
    const language = await Language.findOne({ where: { code: langCode } });
    if (!language) {
      throw ApiError.notFound('Language not found');
    }

    const translations = await Translation.findAll({
      where: { language_id: language.id },
      include: [
        {
          model: TranslationKey,
          as: 'translation_key',
          attributes: ['key', 'default_value', 'group'],
          where: { group },
        },
      ],
    });

    const translationMap = {};
    translations.forEach(t => {
      if (t.translation_key) {
        translationMap[t.translation_key.key] = t.value;
      }
    });

    return translationMap;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get translation statistics
 */
const getStats = async () => {
  try {
    const totalKeys = await TranslationKey.count();
    const languages = await Language.findAll({ where: { is_active: true } });

    const stats = {
      total_keys: totalKeys,
      languages: [],
    };

    for (const language of languages) {
      const totalTranslations = await Translation.count({
        where: { language_id: language.id, is_active: true },
      });
      const autoTranslations = await Translation.count({
        where: { language_id: language.id, status: 'auto', is_active: true },
      });
      const reviewedTranslations = await Translation.count({
        where: { language_id: language.id, status: 'reviewed', is_active: true },
      });
      const missingTranslations = totalKeys - totalTranslations;

      stats.languages.push({
        id: language.id,
        code: language.code,
        name: language.name,
        total: totalTranslations,
        auto: autoTranslations,
        reviewed: reviewedTranslations,
        missing: missingTranslations,
        completion: totalKeys > 0 ? Math.round((totalTranslations / totalKeys) * 100) : 0,
      });
    }

    return stats;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get all unique groups
 */
const getGroups = async () => {
  try {
    const groups = await TranslationKey.findAll({
      attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('group')), 'group']],
      raw: true,
    });
    return groups.map(g => g.group);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Bulk import translation keys
 */
const bulkImport = async (keys, userId = null, autoTranslate = true) => {
  try {
    const results = { created: 0, skipped: 0, errors: [] };

    for (const keyData of keys) {
      try {
        const existing = await TranslationKey.findOne({ where: { key: keyData.key } });
        if (existing) {
          results.skipped++;
          continue;
        }

        await createKey(keyData, userId, autoTranslate);
        results.created++;
      } catch (error) {
        results.errors.push({ key: keyData.key, error: error.message });
      }
    }

    logger.logDB('bulkImport', MODEL_NAME, null, results);
    return results;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Export all translations as JSON
 */
const exportAll = async () => {
  try {
    const keys = await TranslationKey.findAll({
      include: [
        {
          model: Translation,
          as: 'translations',
          include: [
            {
              model: Language,
              as: 'language',
              attributes: ['code'],
            },
          ],
        },
      ],
    });

    const exportData = keys.map(key => {
      const keyData = {
        key: key.key,
        default_value: key.default_value,
        description: key.description,
        group: key.group,
        translations: {},
      };

      key.translations.forEach(t => {
        if (t.language) {
          keyData.translations[t.language.code] = {
            value: t.value,
            status: t.status,
          };
        }
      });

      return keyData;
    });

    return exportData;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

// ==================== MISSING KEYS FUNCTIONALITY ====================

/**
 * Report a missing translation key (called from frontend)
 * This is async and non-blocking for the frontend
 */
const reportMissingKey = async (key, defaultValue = null, pageUrl = null) => {
  try {
    // Check if key already exists in translation_keys
    const existingKey = await TranslationKey.findOne({ where: { key } });
    if (existingKey) {
      return { status: 'exists', key };
    }

    // Check if already in missing_translation_keys
    const existing = await MissingTranslationKey.findOne({ where: { key } });

    if (existing) {
      // Update report count and last reported timestamp
      await existing.update({
        report_count: existing.report_count + 1,
        last_reported_at: new Date(),
        default_value: defaultValue || existing.default_value,
        page_url: pageUrl || existing.page_url,
      });
      return { status: 'updated', key };
    }

    // Create new missing key entry
    await MissingTranslationKey.create({
      key,
      default_value: defaultValue,
      page_url: pageUrl,
      report_count: 1,
      first_reported_at: new Date(),
      last_reported_at: new Date(),
    });

    logger.logDB('reportMissingKey', 'MissingTranslationKey', null, { key });
    return { status: 'created', key };
  } catch (error) {
    // Don't throw - this should be silent and non-blocking
    logger.logError(error);
    return { status: 'error', key, error: error.message };
  }
};

/**
 * Get all missing translation keys
 */
const getMissingKeys = async (query = {}) => {
  try {
    const { page = 1, limit = 50, resolved = 'false' } = query;
    const offset = (page - 1) * limit;

    const where = {};
    if (resolved !== 'all') {
      where.is_active = resolved === 'true' ? 0 : 1;
    }

    const { count, rows } = await MissingTranslationKey.findAndCountAll({
      where,
      order: [['report_count', 'DESC'], ['last_reported_at', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    return {
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit),
        hasNextPage: page * limit < count,
        hasPrevPage: page > 1,
      },
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get count of unresolved missing keys (for dashboard alert)
 */
const getMissingKeysCount = async () => {
  try {
    const count = await MissingTranslationKey.count({
      where: { is_active: 1 },
    });
    return { count };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create a translation key from a missing key entry
 */
const createKeyFromMissing = async (missingKeyId, data = {}, userId = null) => {
  try {
    const missingKey = await MissingTranslationKey.findByPk(missingKeyId);
    if (!missingKey) {
      throw ApiError.notFound('Missing key entry not found');
    }

    // Extract group from key (e.g., "common.save" -> "common")
    const keyParts = missingKey.key.split('.');
    const group = keyParts.length > 1 ? keyParts[0] : 'common';

    // Create the translation key
    const keyData = {
      key: missingKey.key,
      default_value: data.default_value || missingKey.default_value || missingKey.key,
      description: data.description || null,
      group: data.group || group,
    };

    const translationKey = await createKey(keyData, userId, true);

    // Mark as resolved
    await missingKey.update({ is_active: 0 });

    logger.logDB('createKeyFromMissing', 'TranslationKey', translationKey.id);
    return translationKey;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create all missing keys with auto-translation
 */
const createAllMissingKeys = async (userId = null) => {
  try {
    const missingKeys = await MissingTranslationKey.findAll({
      where: { is_active: 1 },
    });

    const results = { created: 0, failed: 0, errors: [] };

    for (const missingKey of missingKeys) {
      try {
        // Extract group from key
        const keyParts = missingKey.key.split('.');
        const group = keyParts.length > 1 ? keyParts[0] : 'common';

        // Check if key was already created (shouldn't happen but safety check)
        const existing = await TranslationKey.findOne({ where: { key: missingKey.key } });
        if (existing) {
          await missingKey.update({ is_active: 0 });
          continue;
        }

        // Create the translation key
        const keyData = {
          key: missingKey.key,
          default_value: missingKey.default_value || missingKey.key,
          group,
        };

        await createKey(keyData, userId, true);

        // Mark as resolved
        await missingKey.update({ is_active: 0 });
        results.created++;
      } catch (error) {
        results.failed++;
        results.errors.push({ key: missingKey.key, error: error.message });
      }
    }

    logger.logDB('createAllMissingKeys', 'TranslationKey', null, results);
    return results;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete a missing key entry
 */
const deleteMissingKey = async (id) => {
  try {
    const missingKey = await MissingTranslationKey.findByPk(id);
    if (!missingKey) {
      throw ApiError.notFound('Missing key entry not found');
    }

    await missingKey.destroy();
    logger.logDB('deleteMissingKey', 'MissingTranslationKey', id);
    return { success: true };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Ignore (mark as resolved without creating) a missing key
 */
const ignoreMissingKey = async (id) => {
  try {
    const missingKey = await MissingTranslationKey.findByPk(id);
    if (!missingKey) {
      throw ApiError.notFound('Missing key entry not found');
    }

    await missingKey.update({ is_active: 0 });
    logger.logDB('ignoreMissingKey', 'MissingTranslationKey', id);
    return { success: true };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

module.exports = {
  getAllKeys,
  getKeyById,
  createKey,
  updateKey,
  deleteKey,
  getOrCreateTranslation,
  updateTranslation,
  updateTranslations,
  translateKeyToAllLanguages,
  retranslateKey,
  translateAllToLanguage,
  getTranslationsForLanguage,
  getTranslationsByGroup,
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
