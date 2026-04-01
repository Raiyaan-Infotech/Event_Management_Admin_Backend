const { Setting } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'Setting';

/**
 * Get all settings
 */
const getAll = async (query = {}, companyId = undefined) => {
  return baseService.getAll(Setting, MODEL_NAME, query, {
    searchFields: ['key', 'description'],
    sortableFields: ['created_at', 'key', 'group'],
    companyId,
  });
};

/**
 * Get setting by key
 */
const getByKey = async (key, companyId = undefined) => {
  try {
    const where = { key };
    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const setting = await Setting.findOne({ where });

    if (!setting) {
      throw ApiError.notFound('Setting not found');
    }

    logger.logDB('findByKey', MODEL_NAME, null, { key });
    return setting;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get settings by group
 */
const getByGroup = async (group, companyId = undefined) => {
  try {
    const where = { group, is_active: true };
    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const settings = await Setting.findAll({
      where,
      order: [['key', 'ASC']],
    });

    logger.logDB('findByGroup', MODEL_NAME, null, { group });
    return settings;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get public settings (for frontend)
 */
const getPublic = async (companyId = undefined) => {
  try {
    const publicGroups = ['general', 'theme', 'appearance', 'analytics', 'social_login'];

    // Never expose secrets or internal-only keys to unauthenticated callers
    const sensitiveKeys = [
      'google_client_secret',
      'facebook_app_secret',
      'google_redirect_uri',
      'facebook_redirect_uri',
    ];

    const where = {
      group: publicGroups,
      is_active: true,
    };

    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const settings = await Setting.findAll({
      where,
      attributes: ['key', 'value', 'type', 'group'],
    });

    // Convert to key-value object, skip sensitive keys
    const result = {};
    settings.forEach(s => {
      if (!sensitiveKeys.includes(s.key)) {
        result[s.key] = s.type === 'json' ? JSON.parse(s.value) : s.value;
      }
    });

    logger.logDB('getPublic', MODEL_NAME);
    return result;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update setting by key
 */
const update = async (key, value, userId = null, companyId = undefined) => {
  try {
    const where = { key };
    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const setting = await Setting.findOne({ where });

    if (!setting) {
      throw ApiError.notFound('Setting not found');
    }

    const oldValue = setting.value;

    await setting.update({
      value: typeof value === 'object' ? JSON.stringify(value) : value,
      updated_by: userId,
    });

    logger.logDB('update', MODEL_NAME, setting.id);
    logger.logActivity(userId, 'update', MODEL_NAME, `Updated setting: ${key}`, {
      key,
      oldValue,
      newValue: value,
    });

    return setting;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Bulk update settings (upsert - creates if not exists)
 */
const bulkUpdate = async (settings, group = 'general', userId = null, companyId = undefined) => {
  try {
    const results = [];

    for (const [key, value] of Object.entries(settings)) {
      const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

      const whereClause = { key };
      if (companyId !== undefined && companyId !== null) {
        whereClause.company_id = companyId;
      }

      const [setting, created] = await Setting.findOrCreate({
        where: whereClause,
        defaults: {
          value: strValue,
          group,
          type: 'text',
          created_by: userId,
          ...(companyId !== undefined && companyId !== null ? { company_id: companyId } : {}),
        },
      });

      if (!created) {
        await setting.update({
          value: strValue,
          updated_by: userId,
        });
      }

      results.push(setting);
    }

    logger.logDB('bulkUpdate', MODEL_NAME, null, { count: results.length });
    logger.logActivity(userId, 'bulk_update', MODEL_NAME, `Bulk updated ${results.length} settings`);

    return results;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create or update setting
 */
const upsert = async (key, value, options = {}, userId = null, companyId = undefined) => {
  try {
    const whereClause = { key };
    if (companyId !== undefined && companyId !== null) {
      whereClause.company_id = companyId;
    }

    const [setting, created] = await Setting.findOrCreate({
      where: whereClause,
      defaults: {
        value: typeof value === 'object' ? JSON.stringify(value) : value,
        group: options.group || 'general',
        type: options.type || 'text',
        description: options.description,
        created_by: userId,
        ...(companyId !== undefined && companyId !== null ? { company_id: companyId } : {}),
      },
    });

    if (!created) {
      await setting.update({
        value: typeof value === 'object' ? JSON.stringify(value) : value,
        updated_by: userId,
      });
    }

    logger.logDB(created ? 'create' : 'update', MODEL_NAME, setting.id);
    return setting;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

module.exports = {
  getAll,
  getByKey,
  getByGroup,
  getPublic,
  update,
  bulkUpdate,
  upsert,
};
