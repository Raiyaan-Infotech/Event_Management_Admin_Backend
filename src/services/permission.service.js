const { Permission } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const { generateSlug } = require('../utils/helpers');

const MODEL_NAME = 'Permission';

/**
 * Get all permissions with pagination
 */
const getAll = async (query = {}, companyId = undefined) => {
  const { Op } = require('sequelize');

  // Custom where to include global permissions (company_id is NULL)
  // and permissions specific to the current company
  let customWhere = {};
  if (companyId !== undefined && companyId !== null) {
    customWhere.company_id = {
      [Op.or]: [companyId, null]
    };
  }

  return baseService.getAll(Permission, MODEL_NAME, query, {
    searchFields: ['name', 'slug', 'module', 'description'],
    sortableFields: ['created_at', 'name', 'module'],
    companyId: undefined, // Disable strict filter in baseService
    where: customWhere,   // Use our custom hybrid filter instead
  });
};

/**
 * Get permission by ID
 */
const getById = async (id, companyId = undefined) => {
  return baseService.getById(Permission, MODEL_NAME, id, { companyId });
};

/**
 * Create new permission
 */
const create = async (data, userId = null, companyId = undefined) => {
  try {
    // Generate slug if not provided (dot notation: module.action)
    if (!data.slug) {
      data.slug = `${generateSlug(data.module)}.${generateSlug(data.name)}`;
    }

    // Uniqueness check scoped to company
    const whereClause = { slug: data.slug };
    if (companyId !== undefined && companyId !== null) {
      whereClause.company_id = companyId;
    }

    const existingPermission = await Permission.findOne({ where: whereClause });
    if (existingPermission) {
      throw ApiError.conflict('Permission with this slug already exists');
    }

    return baseService.create(Permission, MODEL_NAME, data, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update permission
 */
const update = async (id, data, userId = null, companyId = undefined) => {
  try {
    const permission = await Permission.findByPk(id);
    if (!permission) {
      throw ApiError.notFound('Permission not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (permission.company_id && permission.company_id !== companyId) {
        throw ApiError.notFound('Permission not found');
      }
    }

    // Check slug uniqueness within company
    if (data.slug && data.slug !== permission.slug) {
      const whereClause = { slug: data.slug };
      if (companyId !== undefined && companyId !== null) {
        whereClause.company_id = companyId;
      }
      const existingPermission = await Permission.findOne({ where: whereClause });
      if (existingPermission) {
        throw ApiError.conflict('Permission with this slug already exists');
      }
    }

    return baseService.update(Permission, MODEL_NAME, id, data, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete permission (soft delete)
 */
const remove = async (id, userId = null, companyId = undefined) => {
  return baseService.remove(Permission, MODEL_NAME, id, userId, companyId, { uniqueFields: ['slug'] });
};

/**
 * Get permissions by module
 */
const getByModule = async (module, companyId = undefined) => {
  try {
    const where = { module, is_active: true };
    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const permissions = await Permission.findAll({
      where,
      order: [['name', 'ASC']],
    });

    logger.logDB('findByModule', MODEL_NAME, null, { module });
    return permissions;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Bulk create permissions
 */
const bulkCreate = async (permissions, userId = null, companyId = undefined) => {
  try {
    const data = permissions.map(p => ({
      ...p,
      slug: p.slug || `${generateSlug(p.module)}.${generateSlug(p.name)}`,
      created_by: userId,
      ...(companyId !== undefined && companyId !== null ? { company_id: companyId } : {}),
    }));

    const created = await Permission.bulkCreate(data, {
      ignoreDuplicates: true,
    });

    logger.logDB('bulkCreate', MODEL_NAME, null, { count: created.length });
    logger.logActivity(userId, 'bulk_create', MODEL_NAME, `Bulk created ${created.length} permissions`);

    return created;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getByModule,
  bulkCreate,
};
