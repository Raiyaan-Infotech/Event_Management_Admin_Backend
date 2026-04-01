const { Op } = require('sequelize');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const { parsePagination, getPaginationMeta, parseSort } = require('../utils/helpers');

/**
 * Build where clause for search and filters
 * @param {Object} query - Query parameters
 * @param {Array} searchFields - Fields to search in
 * @param {Number|null} companyId - Company ID for tenant scoping
 */
const buildWhereClause = (query, searchFields = [], companyId = undefined) => {
  const where = {};

  // Company scoping - only add if companyId is explicitly provided (not undefined)
  if (companyId !== undefined && companyId !== null) {
    where.company_id = companyId;
  }

  // Search functionality
  if (query.search && searchFields.length > 0) {
    where[Op.or] = searchFields.map(field => ({
      [field]: { [Op.like]: `%${query.search}%` }
    }));
  }

  // Status filter
  if (query.status) {
    where.status = query.status;
  }

  // Active filter (supports boolean true/false and numeric 0/1/2)
  if (query.is_active !== undefined) {
    if (query.is_active === 'true' || query.is_active === true) {
      where.is_active = 1;
    } else if (query.is_active === 'false' || query.is_active === false) {
      where.is_active = 0;
    } else {
      where.is_active = parseInt(query.is_active);
    }
  }

  // Type filter (for email templates)
  if (query.type) {
    where.type = query.type;
  }

  return where;
};

/**
 * Get all records with pagination
 * @param {Object} options.companyId - Company ID for tenant scoping
 */
const getAll = async (model, modelName, query = {}, options = {}) => {
  try {
    const { page, limit, offset } = parsePagination(query);
    const order = parseSort(query, options.sortableFields || ['created_at']);
    const whereClause = buildWhereClause(query, options.searchFields || [], options.companyId);

    // Merge custom where conditions
    if (options.where) {
      Object.assign(whereClause, options.where);
    }

    const { count, rows } = await model.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order,
      include: options.include || [],
      attributes: options.attributes,
      distinct: true,
    });

    logger.logDB('findAll', modelName, null, { count, page, limit });

    // Annotate rows with has_pending_approval for update/delete pending approvals
    let data = rows;
    if (options.moduleSlug && rows.length > 0) {
      try {
        const { ApprovalRequest } = require('../models');
        const resourceIds = rows.map(r => r.id);
        const pendingApprovals = await ApprovalRequest.findAll({
          where: {
            module_slug: options.moduleSlug,
            is_active: 2,
            resource_id: resourceIds,
            action: ['update', 'edit', 'delete'],
          },
          attributes: ['resource_id'],
          raw: true,
        });
        const pendingIds = new Set(pendingApprovals.map(a => a.resource_id));
        data = rows.map(r => {
          const plain = r.toJSON ? r.toJSON() : { ...r };
          plain.has_pending_approval = pendingIds.has(r.id);
          return plain;
        });
      } catch (_e) {
        // Non-fatal — return rows without annotation
      }
    }

    return {
      data,
      pagination: getPaginationMeta(count, page, limit),
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get single record by ID
 * @param {Object} options.companyId - Company ID for tenant validation
 */
const getById = async (model, modelName, id, options = {}) => {
  try {
    const record = await model.findByPk(id, {
      include: options.include || [],
      attributes: options.attributes,
    });

    if (!record) {
      throw ApiError.notFound(`${modelName} not found`);
    }

    // Validate company ownership (prevent cross-tenant access)
    if (options.companyId !== undefined && options.companyId !== null) {
      if (record.company_id && record.company_id !== options.companyId) {
        throw ApiError.notFound(`${modelName} not found`);
      }
    }

    logger.logDB('findById', modelName, id);
    return record;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get single record by condition
 * @param {Object} options.companyId - Company ID for tenant scoping
 */
const getOne = async (model, modelName, where, options = {}) => {
  try {
    // Add company scoping to where clause
    if (options.companyId !== undefined && options.companyId !== null) {
      where.company_id = options.companyId;
    }

    const record = await model.findOne({
      where,
      include: options.include || [],
      attributes: options.attributes,
    });

    logger.logDB('findOne', modelName, null, { where });
    return record;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create new record
 * @param {Number|null} companyId - Company ID for tenant scoping
 */
const create = async (model, modelName, data, userId = null, companyId = undefined) => {
  try {
    // Set company_id if provided
    if (companyId !== undefined && companyId !== null) {
      data.company_id = companyId;
    }

    if (userId) {
      data.created_by = userId;
    }

    const record = await model.create(data);
    logger.logDB('create', modelName, record.id);
    await logger.logActivity(userId, 'create', modelName, `Created ${modelName}`, { recordId: record.id, companyId });

    return record;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update record by ID
 * @param {Number|null} companyId - Company ID for tenant validation
 */
const update = async (model, modelName, id, data, userId = null, companyId = undefined) => {
  try {
    const record = await model.findByPk(id);

    if (!record) {
      throw ApiError.notFound(`${modelName} not found`);
    }

    // Validate company ownership (prevent cross-tenant modification)
    if (companyId !== undefined && companyId !== null) {
      if (record.company_id && record.company_id !== companyId) {
        throw ApiError.notFound(`${modelName} not found`);
      }
    }

    const oldValues = record.toJSON();

    if (userId) {
      data.updated_by = userId;
    }

    await record.update(data);
    logger.logDB('update', modelName, id);
    await logger.logActivity(userId, 'update', modelName, `Updated ${modelName}`, {
      recordId: id,
      oldValues,
      newValues: data,
      companyId,
    });

    return record;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete record by ID (soft delete)
 * @param {Number|null} companyId - Company ID for tenant validation
 * @param {Object} options - Additional options for delete operations
 */
const remove = async (model, modelName, id, userId = null, companyId = undefined, options = {}) => {
  try {
    const record = await model.findByPk(id);

    if (!record) {
      throw ApiError.notFound(`${modelName} not found`);
    }

    // Validate company ownership (prevent cross-tenant deletion)
    if (companyId !== undefined && companyId !== null) {
      if (record.company_id && record.company_id !== companyId) {
        throw ApiError.notFound(`${modelName} not found`);
      }
    }

    // Set is_active to 0 before soft-deleting so inactive status is immediately visible
    if (model.rawAttributes && model.rawAttributes.is_active !== undefined) {
      record.is_active = 0;
    }

    // Append timestamp to unique fields to allow recreation without unique constraint errors
    if (model.rawAttributes) {
      const uniqueFields = options.uniqueFields || ['slug', 'key'];

      uniqueFields.forEach(field => {
        if (model.rawAttributes[field] !== undefined && record[field]) {
          const colLen = model.rawAttributes[field].type?.options?.length
            || model.rawAttributes[field].type?._length
            || 200;
          // Build a unique deleted suffix.
          // For long columns (>=15): use timestamp suffix (preserves original prefix).
          // For short columns (<15): use record ID in base36 which is compact and unique.
          const tsStamp = `-d${Date.now().toString().slice(-13)}`; // 15 chars
          let stamp;
          if (colLen >= tsStamp.length) {
            stamp = tsStamp;
          } else {
            // base36 ID is compact: ID 1-35 = 1 char, 36-1295 = 2 chars, etc.
            stamp = `d${(record.id || 0).toString(36)}`;
          }
          // For email fields: insert stamp before '@' to keep value a valid email address
          const hasEmailValidation = model.rawAttributes[field].validate?.isEmail;
          if (hasEmailValidation && record[field].includes('@')) {
            const [local, domain] = record[field].split('@');
            const maxLocal = Math.max(0, colLen - domain.length - 1 - stamp.length);
            record[field] = (local.substring(0, maxLocal) + stamp + '@' + domain).substring(0, colLen);
          } else {
            const maxPrefix = Math.max(0, colLen - stamp.length);
            record[field] = (record[field].substring(0, maxPrefix) + stamp).substring(0, colLen);
          }
        }
      });
    }

    // Save changes before destroying
    if (record.changed()) {
      await record.save();
    }

    await record.destroy();
    logger.logDB('delete', modelName, id);
    await logger.logActivity(userId, 'delete', modelName, `Deleted ${modelName}`, { recordId: id, companyId });

    return true;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Restore soft deleted record
 * @param {Number|null} companyId - Company ID for tenant validation
 */
const restore = async (model, modelName, id, userId = null, companyId = undefined) => {
  try {
    const record = await model.findByPk(id, { paranoid: false });

    if (!record) {
      throw ApiError.notFound(`${modelName} not found`);
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (record.company_id && record.company_id !== companyId) {
        throw ApiError.notFound(`${modelName} not found`);
      }
    }

    await record.restore();
    logger.logDB('restore', modelName, id);
    await logger.logActivity(userId, 'restore', modelName, `Restored ${modelName}`, { recordId: id, companyId });

    return record;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Hard delete record
 * @param {Number|null} companyId - Company ID for tenant validation
 */
const hardDelete = async (model, modelName, id, userId = null, companyId = undefined) => {
  try {
    const record = await model.findByPk(id, { paranoid: false });

    if (!record) {
      throw ApiError.notFound(`${modelName} not found`);
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (record.company_id && record.company_id !== companyId) {
        throw ApiError.notFound(`${modelName} not found`);
      }
    }

    await record.destroy({ force: true });
    logger.logDB('hardDelete', modelName, id);
    await logger.logActivity(userId, 'hard_delete', modelName, `Permanently deleted ${modelName}`, { recordId: id, companyId });

    return true;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Check if record exists
 * @param {Number|null} companyId - Company ID for tenant scoping
 */
const exists = async (model, where, companyId = undefined) => {
  try {
    // Add company scoping
    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const count = await model.count({ where });
    return count > 0;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Count records
 * @param {Number|null} companyId - Company ID for tenant scoping
 */
const count = async (model, where = {}, companyId = undefined) => {
  try {
    // Add company scoping
    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    return await model.count({ where });
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

module.exports = {
  buildWhereClause,
  getAll,
  getById,
  getOne,
  create,
  update,
  remove,
  restore,
  hardDelete,
  exists,
  count,
};