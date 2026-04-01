const { Role, Permission, RolePermission, User } = require('../models');
const { Op } = require('sequelize');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const { generateSlug } = require('../utils/helpers');

const MODEL_NAME = 'Role';

/**
 * Get all roles with pagination
 */
const getAll = async (query = {}, companyId = undefined) => {
  return baseService.getAll(Role, MODEL_NAME, query, {
    searchFields: ['name', 'slug', 'description'],
    sortableFields: ['created_at', 'name'],
    companyId,
    attributes: ['id', 'name', 'slug', 'description', 'level', 'is_active', 'is_default', 'company_id', 'approved_at', 'created_at'],
    moduleSlug: 'roles',
  });
};

/**
 * Get role by ID with permissions
 */
const getById = async (id, companyId = undefined) => {
  try {
    const role = await Role.findByPk(id, {
      include: [{
        model: Permission,
        as: 'permissions',
      }],
    });

    if (!role) {
      throw ApiError.notFound('Role not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (role.company_id && role.company_id !== companyId) {
        throw ApiError.notFound('Role not found');
      }
    }

    logger.logDB('findById', MODEL_NAME, id);
    return role;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create new role
 */
const create = async (data, userId = null, companyId = undefined) => {
  try {
    if (!data.slug) {
      data.slug = generateSlug(data.name);
    }

    // Uniqueness check scoped to company
    const whereClause = { slug: data.slug };
    if (companyId !== undefined && companyId !== null) {
      whereClause.company_id = companyId;
    }

    const existingRole = await Role.findOne({ where: whereClause });
    if (existingRole) {
      throw ApiError.conflict('Role with this slug already exists');
    }

    if (userId) {
      data.created_by = userId;
    }
    if (companyId !== undefined && companyId !== null) {
      data.company_id = companyId;
    }

    const role = await Role.create(data);

    logger.logDB('create', MODEL_NAME, role.id);
    logger.logActivity(userId, 'create', MODEL_NAME, `Created role: ${role.name}`, { recordId: role.id, companyId });

    return getById(role.id, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update role
 */
const update = async (id, data, userId = null, companyId = undefined) => {
  try {
    const role = await Role.findByPk(id);
    if (!role) {
      throw ApiError.notFound('Role not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (role.company_id && role.company_id !== companyId) {
        throw ApiError.notFound('Role not found');
      }
    }

    // Check slug uniqueness within company
    if (data.slug && data.slug !== role.slug) {
      const whereClause = { slug: data.slug };
      if (companyId !== undefined && companyId !== null) {
        whereClause.company_id = companyId;
      }
      const existingRole = await Role.findOne({ where: whereClause });
      if (existingRole) {
        throw ApiError.conflict('Role with this slug already exists');
      }
    }

    const oldValues = role.toJSON();

    if (userId) {
      data.updated_by = userId;
    }

    await role.update(data);

    logger.logDB('update', MODEL_NAME, id);
    logger.logActivity(userId, 'update', MODEL_NAME, `Updated role: ${role.name}`, {
      recordId: id,
      oldValues,
      newValues: data,
      companyId,
    });

    return getById(id, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete role (soft delete)
 */
const remove = async (id, userId = null, companyId = undefined) => {
  try {
    const role = await Role.findByPk(id);
    if (!role) {
      throw ApiError.notFound('Role not found');
    }

    if (role.is_default) {
      throw ApiError.badRequest('Cannot delete default role');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (role.company_id && role.company_id !== companyId) {
        throw ApiError.notFound('Role not found');
      }
    }

    // Block deletion if employees are still assigned to this role
    const assignedCount = await User.count({ where: { role_id: id } });
    if (assignedCount > 0) {
      throw ApiError.badRequest(
        `Cannot delete role: ${assignedCount} employee${assignedCount > 1 ? 's are' : ' is'} still assigned to this role. Reassign or delete them first.`
      );
    }

    return baseService.remove(Role, MODEL_NAME, id, userId, companyId, { uniqueFields: ['slug'] });
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Assign permissions to role with optional approval requirements
 * @param {number} id - Role ID
 * @param {Array} permissionsData - Array of {permissionId, requiresApproval} objects
 * @param {number} userId - User performing the action
 * @param {number} companyId - Company ID
 */
const assignPermissions = async (id, permissionsData, userId = null, companyId = undefined) => {
  try {
    const role = await Role.findByPk(id);
    if (!role) {
      throw ApiError.notFound('Role not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (role.company_id && role.company_id !== companyId) {
        throw ApiError.notFound('Role not found');
      }
    }

    // Extract permission IDs (bodyTransform middleware converts camelCase to snake_case)
    const permissionIds = permissionsData.map(p =>
      typeof p === 'object' ? p.permission_id : p
    );

    // Validate permissions (allow system permissions or company-specific permissions)
    const permWhere = { id: permissionIds };
    if (companyId !== undefined && companyId !== null) {
      // Allow permissions that are either system-level (company_id = NULL) or belong to this company
      permWhere[Op.or] = [
        { company_id: null },
        { company_id: companyId }
      ];
    }

    const permissions = await Permission.findAll({ where: permWhere });

    if (permissions.length !== permissionIds.length) {
      throw ApiError.badRequest('Some permissions are invalid or belong to another company');
    }

    // Hard delete all existing permissions for this role (activity log is the audit trail)
    await RolePermission.destroy({ where: { role_id: id }, force: true });

    // Add new permissions with requires_approval flag
    const rolePermissions = permissionsData.map(p => {
      const permissionId = typeof p === 'object' ? p.permission_id : p;
      const requiresApproval = typeof p === 'object' ? (p.requires_approval || false) : false;

      return {
        role_id: id,
        permission_id: permissionId,
        company_id: companyId || null,
        requires_approval: requiresApproval,
      };
    });

    await RolePermission.bulkCreate(rolePermissions);

    logger.logDB('assignPermissions', MODEL_NAME, id);
    logger.logActivity(userId, 'assign_permissions', MODEL_NAME, `Assigned permissions to role: ${role.name}`, {
      recordId: id,
      permissionIds,
      companyId,
    });

    return getById(id, companyId);
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
  assignPermissions,
};
