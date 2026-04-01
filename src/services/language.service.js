const { Language, Translation } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'Language';

/**
 * Get all languages
 */
const getAll = async (query = {}) => {
  return baseService.getAll(Language, MODEL_NAME, query, {
    searchFields: ['name', 'code', 'native_name'],
    sortableFields: ['created_at', 'name', 'code'],
    moduleSlug: 'languages',
  });
};

/**
 * Get language by ID
 */
const getById = async (id) => {
  return baseService.getById(Language, MODEL_NAME, id);
};

/**
 * Get active languages (for frontend)
 */
const getActive = async () => {
  try {
    const languages = await Language.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'code', 'native_name', 'direction', 'is_default'],
      order: [['is_default', 'DESC'], ['name', 'ASC']],
    });

    logger.logDB('getActive', MODEL_NAME);
    return languages;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create language (or restore if soft-deleted)
 */
const create = async (data, userId = null) => {
  try {
    // Check for active language with same code
    const existing = await Language.findOne({ where: { code: data.code } });
    if (existing) {
      throw ApiError.conflict('Language with this code already exists');
    }

    // Check for soft-deleted language with same code
    const deletedLanguage = await Language.findOne({
      where: { code: data.code },
      paranoid: false, // Include soft-deleted records
    });

    if (deletedLanguage) {
      // Restore the soft-deleted language
      await deletedLanguage.restore();
      // Update with new data
      await deletedLanguage.update({
        ...data,
        is_active: true,
        updated_by: userId,
      });

      // Reactivate translations for this language
      await Translation.update(
        { is_active: true, updated_by: userId },
        { where: { language_id: deletedLanguage.id } }
      );

      logger.logDB('restore', MODEL_NAME, deletedLanguage.id);
      return deletedLanguage;
    }

    return baseService.create(Language, MODEL_NAME, data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update language
 */
const update = async (id, data, userId = null) => {
  try {
    const language = await Language.findByPk(id);
    if (!language) {
      throw ApiError.notFound('Language not found');
    }

    // Check code uniqueness
    if (data.code && data.code !== language.code) {
      const existing = await Language.findOne({ where: { code: data.code } });
      if (existing) {
        throw ApiError.conflict('Language with this code already exists');
      }
    }

    return baseService.update(Language, MODEL_NAME, id, data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete language
 */
const remove = async (id, userId = null) => {
  try {
    const language = await Language.findByPk(id);
    if (!language) {
      throw ApiError.notFound('Language not found');
    }

    // Prevent deleting default language
    if (language.is_default) {
      throw ApiError.badRequest('Cannot delete default language');
    }

    // Deactivate all translations for this language (soft delete)
    const [updatedCount] = await Translation.update(
      { is_active: false, updated_by: userId },
      { where: { language_id: id } }
    );
    logger.logDB('deactivate', 'Translation', `Deactivated ${updatedCount} translations for language ${id}`);

    return baseService.remove(Language, MODEL_NAME, id, userId, undefined, { uniqueFields: ['code'] });
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Set default language
 */
const setDefault = async (id, userId = null) => {
  try {
    const language = await Language.findByPk(id);
    if (!language) {
      throw ApiError.notFound('Language not found');
    }

    // Remove default from all languages
    await Language.update({ is_default: false }, { where: {} });

    // Set this language as default
    await language.update({
      is_default: true,
      updated_by: userId,
    });

    logger.logDB('setDefault', MODEL_NAME, id);
    logger.logActivity(userId, 'set_default', MODEL_NAME, `Set default language: ${language.name}`, { recordId: id });

    return language;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

module.exports = {
  getAll,
  getById,
  getActive,
  create,
  update,
  remove,
  setDefault,
};
