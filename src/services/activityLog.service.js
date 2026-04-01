const { ActivityLog, User } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { parsePagination, getPaginationMeta, parseSort } = require('../utils/helpers');

const MODEL_NAME = 'ActivityLog';

/**
 * Get all activity logs with pagination
 */
const getAll = async (query = {}, companyId = undefined) => {
  try {
    const { page, limit, offset } = parsePagination(query);
    const order = parseSort(query, ['id', 'action', 'module', 'user_id', 'created_at']);

    const where = {};

    // Company scoping
    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    // Filter by action
    if (query.action) {
      where.action = query.action;
    }

    // Filter by module
    if (query.module) {
      where.module = query.module;
    }

    // Filter by user
    if (query.user_id) {
      where.user_id = query.user_id;
    }

    // Filter by date range
    if (query.start_date && query.end_date) {
      where.created_at = {
        [Op.between]: [new Date(query.start_date), new Date(query.end_date)],
      };
    }

    const { count, rows } = await ActivityLog.findAndCountAll({
      where,
      limit,
      offset,
      order,
attributes: ['id', 'action', 'description', 'ip_address', 'user_id', 'created_at'], // ✅ not 'createdAt'D      include: [{
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'full_name', 'email'],
      }],
    });

    logger.logDB('findAll', MODEL_NAME, null, { count, page, limit });

    return {
      data: rows,
      pagination: getPaginationMeta(count, page, limit),
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get activity logs by user
 */
const getByUser = async (userId, query = {}, companyId = undefined) => {
  query.user_id = userId;
  return getAll(query, companyId);
};

/**
 * Get activity logs by module
 */
const getByModule = async (module, query = {}, companyId = undefined) => {
  query.module = module;
  return getAll(query, companyId);
};

/**
 * Get activity logs for a specific vendor (vendor portal)
 */
const getByVendor = async (vendorId, query = {}) => {
  try {
    const { page, limit, offset } = parsePagination(query);
    const order = parseSort(query, ['id', 'action', 'module', 'created_at']);

    const where = { vendor_id: vendorId };

    if (query.module) {
      where.module = query.module;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.search) {
      where.description = { [Op.like]: `%${query.search}%` };
    }

    const { count, rows } = await ActivityLog.findAndCountAll({
      where,
      limit,
      offset,
      order,
      attributes: ['id', 'action', 'module', 'description', 'ip_address', 'user_agent', 'created_at'],
    });

    logger.logDB('findAll', MODEL_NAME, null, { count, page, limit });

    return {
      data: rows,
      pagination: getPaginationMeta(count, page, limit),
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create activity log
 */
const create = async (data) => {
  try {
    const log = await ActivityLog.create(data);
    logger.logDB('create', MODEL_NAME, log.id);
    return log;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Clear old activity logs
 */
const clearOld = async (days = 90, companyId = undefined) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const where = {
      created_at: {
        [Op.lt]: cutoffDate,
      },
    };

    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const deleted = await ActivityLog.destroy({ where });

    logger.logDB('clearOld', MODEL_NAME, null, { deleted, days });
    return { deleted };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get activity statistics
 */
const getStats = async (days = 30, companyId = undefined) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const where = {
      created_at: {
        [Op.gte]: cutoffDate,
      },
    };

    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const stats = await ActivityLog.findAll({
      where,
      attributes: [
        'action',
        [ActivityLog.sequelize.fn('COUNT', ActivityLog.sequelize.col('id')), 'count'],
      ],
      group: ['action'],
    });

    logger.logDB('getStats', MODEL_NAME);
    return stats;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

module.exports = {
  getAll,
  getByUser,
  getByModule,
  getByVendor,
  create,
  clearOld,
  getStats,
};
