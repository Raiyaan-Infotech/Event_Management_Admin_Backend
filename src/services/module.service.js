const { Module, Permission } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const { generateSlug } = require('../utils/helpers');

const MODEL_NAME = 'Module';

// Standard actions auto-generated for every module
const STANDARD_ACTIONS = [
  { name: 'View', action: 'view', description: 'Can view and list records' },
  { name: 'Create', action: 'create', description: 'Can create new records' },
  { name: 'Edit', action: 'edit', description: 'Can edit and update records' },
  { name: 'Delete', action: 'delete', description: 'Can delete records' },
  { name: 'Manage', action: 'manage', description: 'Full control including special operations' },
];

/**
 * Get all modules with pagination
 */
const getAll = async (query = {}, companyId = undefined) => {
  return baseService.getAll(Module, MODEL_NAME, query, {
    searchFields: ['name', 'slug', 'description'],
    sortableFields: ['created_at', 'name'],
    companyId,
    include: [{
      model: Permission,
      as: 'permissions',
      attributes: ['id', 'name', 'slug', 'module', 'is_active'],
    }],
  });
};

/**
 * Get module by ID with permissions
 */
const getById = async (id, companyId = undefined) => {
  try {
    const module = await Module.findByPk(id, {
      include: [{
        model: Permission,
        as: 'permissions',
      }],
    });

    if (!module) {
      throw ApiError.notFound('Module not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (module.company_id && module.company_id !== companyId) {
        throw ApiError.notFound('Module not found');
      }
    }

    logger.logDB('findById', MODEL_NAME, id);
    return module;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create new module and auto-generate permissions
 */
const create = async (data, userId = null, companyId = undefined) => {
  try {
    const slug = data.slug || generateSlug(data.name);

    // Uniqueness check scoped to company
    const whereClause = { slug };
    if (companyId !== undefined && companyId !== null) {
      whereClause.company_id = companyId;
    }

    const existing = await Module.findOne({ where: whereClause });
    if (existing) {
      throw ApiError.conflict('Module with this slug already exists');
    }

    const moduleData = {
      name: data.name,
      slug,
      description: data.description || null,
      created_by: userId,
    };

    if (companyId !== undefined && companyId !== null) {
      moduleData.company_id = companyId;
    }

    const newModule = await Module.create(moduleData);

    // Auto-generate standard permissions
    const permissions = STANDARD_ACTIONS.map(action => ({
      name: `${data.name} ${action.name}`,
      slug: `${slug}.${action.action}`,
      module: slug,
      module_id: newModule.id,
      description: `${action.description} for ${data.name}`,
      created_by: userId,
      ...(companyId !== undefined && companyId !== null ? { company_id: companyId } : {}),
    }));

    await Permission.bulkCreate(permissions, { ignoreDuplicates: true });

    logger.logDB('create', MODEL_NAME, newModule.id);
    logger.logActivity(userId, 'create', MODEL_NAME, `Created module: ${newModule.name} with ${permissions.length} permissions`, {
      recordId: newModule.id,
    });

    return getById(newModule.id, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update module
 */
const update = async (id, data, userId = null, companyId = undefined) => {
  try {
    const existingModule = await Module.findByPk(id);
    if (!existingModule) {
      throw ApiError.notFound('Module not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (existingModule.company_id && existingModule.company_id !== companyId) {
        throw ApiError.notFound('Module not found');
      }
    }

    // If slug is changing, check uniqueness within company
    if (data.slug && data.slug !== existingModule.slug) {
      const whereClause = { slug: data.slug };
      if (companyId !== undefined && companyId !== null) {
        whereClause.company_id = companyId;
      }
      const duplicate = await Module.findOne({ where: whereClause });
      if (duplicate) {
        throw ApiError.conflict('Module with this slug already exists');
      }
    }

    const oldValues = existingModule.toJSON();

    if (userId) {
      data.updated_by = userId;
    }

    await existingModule.update(data);

    logger.logDB('update', MODEL_NAME, id);
    logger.logActivity(userId, 'update', MODEL_NAME, `Updated module: ${existingModule.name}`, {
      recordId: id,
      oldValues,
      newValues: data,
    });

    return getById(id, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete module and its permissions (soft delete)
 */
const remove = async (id, userId = null, companyId = undefined) => {
  try {
    const existingModule = await Module.findByPk(id);
    if (!existingModule) {
      throw ApiError.notFound('Module not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (existingModule.company_id && existingModule.company_id !== companyId) {
        throw ApiError.notFound('Module not found');
      }
    }

    // Soft delete all permissions linked to this module
    await Permission.destroy({ where: { module_id: id } });

    return baseService.remove(Module, MODEL_NAME, id, userId, companyId, { uniqueFields: ['slug', 'name'] });
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Add custom permission to an existing module
 */
const addPermission = async (id, data, userId = null, companyId = undefined) => {
  try {
    const existingModule = await Module.findByPk(id);
    if (!existingModule) {
      throw ApiError.notFound('Module not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (existingModule.company_id && existingModule.company_id !== companyId) {
        throw ApiError.notFound('Module not found');
      }
    }

    const slug = `${existingModule.slug}.${data.action}`;

    // Check permission slug uniqueness within company
    const whereClause = { slug };
    if (companyId !== undefined && companyId !== null) {
      whereClause.company_id = companyId;
    }

    const existing = await Permission.findOne({ where: whereClause });
    if (existing) {
      throw ApiError.conflict(`Permission "${slug}" already exists`);
    }

    const permission = await Permission.create({
      name: `${existingModule.name} ${data.name}`,
      slug,
      module: existingModule.slug,
      module_id: existingModule.id,
      description: data.description || null,
      created_by: userId,
      ...(companyId !== undefined && companyId !== null ? { company_id: companyId } : {}),
    });

    logger.logDB('addPermission', MODEL_NAME, id);
    logger.logActivity(userId, 'add_permission', MODEL_NAME, `Added custom permission "${slug}" to module: ${existingModule.name}`, {
      recordId: id,
      permissionId: permission.id,
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
  addPermission,
};
