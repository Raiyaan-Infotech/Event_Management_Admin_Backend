const { Currency } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'Currency';

/**
 * Get all currencies
 */
const getAll = async (query = {}) => {
  return baseService.getAll(Currency, MODEL_NAME, query, {
    searchFields: ['name', 'code', 'symbol'],
    sortableFields: ['created_at', 'name', 'code', 'exchange_rate'],
    moduleSlug: 'currencies',
  });
};

/**
 * Get currency by ID
 */
const getById = async (id) => {
  return baseService.getById(Currency, MODEL_NAME, id);
};

/**
 * Get active currencies (for frontend)
 */
const getActive = async () => {
  try {
    const currencies = await Currency.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'code', 'symbol', 'exchange_rate', 'decimal_places', 'is_default'],
      order: [['is_default', 'DESC'], ['name', 'ASC']],
    });

    logger.logDB('getActive', MODEL_NAME);
    return currencies;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create currency
 */
const create = async (data, userId = null) => {
  try {
    const existing = await Currency.findOne({ where: { code: data.code } });
    if (existing) {
      throw ApiError.conflict('Currency with this code already exists');
    }
    return baseService.create(Currency, MODEL_NAME, data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update currency
 */
const update = async (id, data, userId = null) => {
  try {
    const currency = await Currency.findByPk(id);
    if (!currency) {
      throw ApiError.notFound('Currency not found');
    }

    // Check code uniqueness
    if (data.code && data.code !== currency.code) {
      const existing = await Currency.findOne({ where: { code: data.code } });
      if (existing) {
        throw ApiError.conflict('Currency with this code already exists');
      }
    }

    return baseService.update(Currency, MODEL_NAME, id, data, userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete currency
 */
const remove = async (id, userId = null) => {
  try {
    const currency = await Currency.findByPk(id);
    if (!currency) {
      throw ApiError.notFound('Currency not found');
    }

    // Prevent deleting default currency
    if (currency.is_default) {
      throw ApiError.badRequest('Cannot delete default currency');
    }

    return baseService.remove(Currency, MODEL_NAME, id, userId, undefined, { uniqueFields: ['code'] });
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Set default currency
 */
const setDefault = async (id, userId = null) => {
  try {
    const currency = await Currency.findByPk(id);
    if (!currency) {
      throw ApiError.notFound('Currency not found');
    }

    // Remove default from all currencies
    await Currency.update({ is_default: false }, { where: {} });

    // Set this currency as default
    await currency.update({
      is_default: true,
      updated_by: userId,
    });

    logger.logDB('setDefault', MODEL_NAME, id);
    logger.logActivity(userId, 'set_default', MODEL_NAME, `Set default currency: ${currency.name}`, { recordId: id });

    return currency;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update exchange rate
 */
const updateExchangeRate = async (id, exchangeRate, userId = null) => {
  try {
    const currency = await Currency.findByPk(id);
    if (!currency) {
      throw ApiError.notFound('Currency not found');
    }

    const oldRate = currency.exchange_rate;

    await currency.update({
      exchange_rate: exchangeRate,
      updated_by: userId,
    });

    logger.logDB('updateExchangeRate', MODEL_NAME, id);
    logger.logActivity(userId, 'update_exchange_rate', MODEL_NAME, `Updated exchange rate for ${currency.code}`, {
      recordId: id,
      oldRate,
      newRate: exchangeRate,
    });

    return currency;
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
  updateExchangeRate,
};
