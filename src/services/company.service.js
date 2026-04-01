const { Company, User, Role, Permission, Module, Setting, RefreshToken } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');

const MODEL_NAME = 'Company';

/**
 * Get all companies with pagination
 */
const getAll = async (query = {}) => {
  return baseService.getAll(Company, MODEL_NAME, query, {
    searchFields: ['name', 'slug', 'email', 'phone'],
    sortableFields: ['created_at', 'name', 'is_active'],
    attributes: ['id', 'name', 'slug', 'email', 'is_active', 'max_users', 'logo', 'created_at'],
  });
};

/**
 * Get company by ID with stats
 */
const getById = async (id) => {
  try {
    const company = await Company.findByPk(id, {
      include: [
        {
          model: User,
          as: 'users',
          attributes: ['id', 'full_name', 'email', 'is_active', 'role_id'],
          include: [
            {
              model: Role,
              as: 'role',
              attributes: ['id', 'name', 'slug', 'level'],
            },
          ],
        },
      ],
    });

    if (!company) {
      throw ApiError.notFound('Company not found');
    }

    // Calculate stats
    const stats = {
      total_users: company.users?.length || 0,
      active_users: company.users?.filter(u => u.is_active === 1).length || 0,
      super_admins: company.users?.filter(u => u.role?.level >= 100).length || 0,
      admins: company.users?.filter(u => u.role?.level >= 50 && u.role?.level < 100).length || 0,
    };

    logger.logDB('findById', MODEL_NAME, id);
    return { ...company.toJSON(), stats };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create new company with initial super admin
 */
const create = async (data, userId = null) => {
  const transaction = await Company.sequelize.transaction();

  try {
    // Validate slug uniqueness
    const existingCompany = await Company.findOne({ where: { slug: data.slug } });
    if (existingCompany) {
      throw ApiError.conflict('Company slug already exists');
    }

    // Validate email uniqueness
    if (data.email) {
      const existingEmail = await Company.findOne({ where: { email: data.email } });
      if (existingEmail) {
        throw ApiError.conflict('Company email already exists');
      }
    }

    // Extract admin data
    const { admin_full_name, admin_email, admin_password, ...companyData } = data;

    // Validate admin data
    if (!admin_full_name || !admin_email || !admin_password) {
      throw ApiError.badRequest('Admin details are required (admin_full_name, admin_email, admin_password)');
    }

    // Check if admin email already exists
    const existingUser = await User.findOne({ where: { email: admin_email } });
    if (existingUser) {
      throw ApiError.conflict('Admin email already exists');
    }

    if (userId) {
      companyData.created_by = userId;
    }

    // Create company
    const company = await Company.create(companyData, { transaction });

    // Copy system-level modules and permissions
    const systemModules = await Module.findAll({ where: { company_id: null } });
    const systemPermissions = await Permission.findAll({ where: { company_id: null } });

    // Create company-scoped modules
    const moduleMapping = {};
    for (const module of systemModules) {
      const newModule = await Module.create({
        name: module.name,
        slug: module.slug,
        icon: module.icon,
        display_order: module.display_order,
        is_active: module.is_active,
        company_id: company.id,
        created_by: userId,
      }, { transaction });
      moduleMapping[module.id] = newModule.id;
    }

    // Create company-scoped permissions
    const permissionMapping = {};
    for (const permission of systemPermissions) {
      const newPermission = await Permission.create({
        name: permission.name,
        slug: permission.slug,
        description: permission.description,
        module_id: moduleMapping[permission.module_id] || null,
        company_id: company.id,
        created_by: userId,
      }, { transaction });
      permissionMapping[permission.id] = newPermission.id;
    }

    // Create super_admin role for this company
    const superAdminRole = await Role.create({
      name: 'Super Admin',
      slug: 'super_admin',
      description: 'Company Super Administrator with full access',
      level: 100,
      company_id: company.id,
      created_by: userId,
    }, { transaction });

    // Assign all permissions to super_admin role
    const companyPermissions = await Permission.findAll({
      where: { company_id: company.id },
      transaction
    });
    await superAdminRole.setPermissions(companyPermissions, { transaction });

    // Hash admin password
    const hashedPassword = await bcrypt.hash(admin_password, 10);

    // Create super admin user
    const adminUser = await User.create({
      full_name: admin_full_name,
      email: admin_email,
      password: hashedPassword,
      role_id: superAdminRole.id,
      company_id: company.id,
      is_active: 1,
      created_by: userId,
    }, { transaction });

    await transaction.commit();

    logger.logDB('create', MODEL_NAME, company.id);
    logger.logActivity(userId, 'create', MODEL_NAME, `Created company: ${company.name}`, {
      recordId: company.id,
      adminUserId: adminUser.id
    });

    return getById(company.id);
  } catch (error) {
    await transaction.rollback();
    logger.logError(error);
    throw error;
  }
};

/**
 * Update company
 */
const update = async (id, data, userId = null) => {
  try {
    const company = await Company.findByPk(id);
    if (!company) {
      throw ApiError.notFound('Company not found');
    }

    // Check slug uniqueness
    if (data.slug && data.slug !== company.slug) {
      const existingCompany = await Company.findOne({ where: { slug: data.slug } });
      if (existingCompany) {
        throw ApiError.conflict('Company slug already exists');
      }
    }

    // Check email uniqueness
    if (data.email && data.email !== company.email) {
      const existingEmail = await Company.findOne({ where: { email: data.email } });
      if (existingEmail) {
        throw ApiError.conflict('Company email already exists');
      }
    }

    const oldValues = company.toJSON();

    if (userId) {
      data.updated_by = userId;
    }

    await company.update(data);

    logger.logDB('update', MODEL_NAME, id);
    logger.logActivity(userId, 'update', MODEL_NAME, `Updated company: ${company.name}`, {
      recordId: id,
      oldValues,
      newValues: data,
    });

    return getById(id);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete company (soft delete)
 */
const remove = async (id, userId = null) => {
  return baseService.remove(Company, MODEL_NAME, id, userId, undefined, { uniqueFields: ['slug', 'email'] });
};

/**
 * Update company status
 */
const updateStatus = async (id, is_active, userId = null) => {
  try {
    const company = await Company.findByPk(id);
    if (!company) {
      throw ApiError.notFound('Company not found');
    }

    const oldIsActive = company.is_active;
    await company.update({
      is_active,
      updated_by: userId
    });

    // If suspending the company, kick out all its users immediately
    if (is_active !== 1 && oldIsActive === 1) {
      const companyUsers = await User.findAll({ where: { company_id: id }, attributes: ['id'] });
      if (companyUsers.length > 0) {
        const userIds = companyUsers.map(u => u.id);
        await RefreshToken.destroy({ where: { user_id: userIds } });
      }
    }

    logger.logDB('updateStatus', MODEL_NAME, id);
    logger.logActivity(userId, 'update_status', MODEL_NAME, `Changed company is_active from ${oldIsActive} to ${is_active}`, {
      recordId: id,
      oldIsActive,
      newIsActive: is_active,
    });

    return company;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get developer dashboard with all companies and stats
 */
const getDashboard = async () => {
  try {
    // Use SQL subqueries instead of loading all users into memory
    const companies = await Company.findAll({
      attributes: [
        'id', 'name', 'slug', 'is_active', 'max_users', 'logo', 'created_at',
        [Company.sequelize.literal('(SELECT COUNT(*) FROM users WHERE users.company_id = `Company`.`id` AND users.deleted_at IS NULL)'), 'user_count'],
        [Company.sequelize.literal('(SELECT COUNT(*) FROM users WHERE users.company_id = `Company`.`id` AND users.is_active = 1 AND users.deleted_at IS NULL)'), 'active_user_count'],
      ],
    });

    const totalUsers = await User.count({ where: { company_id: { [Op.not]: null } } });
    const activeUsers = await User.count({
      where: {
        company_id: { [Op.not]: null },
        is_active: 1
      }
    });

    const stats = {
      total_companies: companies.length,
      active_companies: companies.filter(c => c.is_active === 1).length,
      suspended_companies: companies.filter(c => c.is_active === 0).length,
      total_users: totalUsers,
      active_users: activeUsers,
    };

    const companiesWithStats = companies.map(company => company.toJSON());

    logger.logDB('getDashboard', MODEL_NAME);
    return { stats, companies: companiesWithStats };
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
  updateStatus,
  getDashboard,
};