const { User, Role, Permission, Country, State, District, City, RefreshToken } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const emailSenderService = require('./emailSender.service');

const MODEL_NAME = 'User';

/**
 * Get all users with pagination
 */
const getAll = async (query = {}, companyId = undefined) => {
  return baseService.getAll(User, MODEL_NAME, query, {
    searchFields: ['full_name', 'email', 'phone'],
    sortableFields: ['created_at', 'full_name', 'email'],
    companyId,
    attributes: ['id', 'full_name', 'username', 'email', 'phone', 'is_active', 'login_access', 'avatar', 'role_id', 'company_id', 'department', 'designation', 'country_id', 'state_id', 'city_id', 'pincode_id', 'created_at'],
    include: [{
      model: Role,
      as: 'role',
      attributes: ['id', 'name', 'slug', 'level'],
    }],
    moduleSlug: 'employees',
  });
};

/**
 * Get user by ID with relations
 */
const getById = async (id, companyId = undefined) => {
  try {
    const user = await User.findByPk(id, {
      include: [
        {
          model: Role,
          as: 'role',
          include: [{
            model: Permission,
            as: 'permissions',
          }],
        },
        { model: Country, as: 'country', attributes: ['id', 'name', 'code'] },
        { model: State, as: 'state', attributes: ['id', 'name'] },
        { model: District, as: 'city', attributes: ['id', 'name'] },
      ],
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (user.company_id && user.company_id !== companyId) {
        throw ApiError.notFound('User not found');
      }
    }

    logger.logDB('findById', MODEL_NAME, id);
    return user;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create new user
 */
const create = async (data, userId = null, companyId = undefined, creatorRoleLevel = null) => {
  try {
    // Check if email exists (include soft-deleted to catch unstamped legacy deletions)
    const existingUser = await User.findOne({ where: { email: data.email }, paranoid: false });
    if (existingUser) {
      if (existingUser.deleted_at) {
        throw ApiError.conflict('This email belongs to a previously deleted employee. Please use a different email or contact your administrator.');
      }
      throw ApiError.conflict('Email already exists');
    }

    // Validate role
    if (data.role_id) {
      const role = await Role.findByPk(data.role_id);
      if (!role) {
        throw ApiError.badRequest('Invalid role');
      }

      // Validate role belongs to the same company
      if (companyId !== undefined && companyId !== null) {
        if (role.company_id && role.company_id !== companyId) {
          throw ApiError.badRequest('Role does not belong to this company');
        }
      }

      // Enforce role level hierarchy: creator can only assign roles at or below their own level
      if (creatorRoleLevel !== null && role.level > creatorRoleLevel) {
        throw ApiError.forbidden('Cannot assign a role with higher level than your own');
      }
    }

    if (userId) {
      data.created_by = userId;
    }
    if (companyId !== undefined && companyId !== null) {
      data.company_id = companyId;
    }

    const user = await User.create(data);

    logger.logDB('create', MODEL_NAME, user.id);
    logger.logActivity(userId, 'create', MODEL_NAME, `Created user: ${user.email}`, { recordId: user.id, companyId });

    return getById(user.id, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update user
 */
const update = async (id, data, userId = null, companyId = undefined, creatorRoleLevel = null) => {
  try {
    const user = await User.findByPk(id);
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (user.company_id && user.company_id !== companyId) {
        throw ApiError.notFound('User not found');
      }
    }

    // Check email uniqueness
    if (data.email && data.email !== user.email) {
      const existingUser = await User.findOne({ where: { email: data.email } });
      if (existingUser) {
        throw ApiError.conflict('Email already exists');
      }
    }

    // Validate role
    if (data.role_id && data.role_id !== user.role_id) {
      const role = await Role.findByPk(data.role_id);
      if (!role) {
        throw ApiError.badRequest('Invalid role');
      }

      // Validate role belongs to same company
      if (companyId !== undefined && companyId !== null) {
        if (role.company_id && role.company_id !== companyId) {
          throw ApiError.badRequest('Role does not belong to this company');
        }
      }

      // Enforce role level hierarchy
      if (creatorRoleLevel !== null && role.level > creatorRoleLevel) {
        throw ApiError.forbidden('Cannot assign a role with higher level than your own');
      }
    }

    const oldValues = user.toJSON();

    if (userId) {
      data.updated_by = userId;
    }

    await user.update(data);

    // If password was changed by another user (e.g. SuperAdmin changing Admin password),
    // invalidate all refresh tokens to force the target user to re-login
    if (data.password && userId && userId !== id) {
      await RefreshToken.destroy({ where: { user_id: id } });
      logger.info(`Invalidated all refresh tokens for user ${id} after password change by user ${userId}`);
    }

    logger.logDB('update', MODEL_NAME, id);
    logger.logActivity(userId, 'update', MODEL_NAME, `Updated user: ${user.email}`, {
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
 * Delete user (soft delete)
 */
const remove = async (id, userId = null, companyId = undefined) => {
  // Validate company ownership before delete
  if (companyId !== undefined && companyId !== null) {
    const user = await User.findByPk(id);
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    if (user.company_id && user.company_id !== companyId) {
      throw ApiError.notFound('User not found');
    }
  }

  // Invalidate all refresh tokens so the deleted user is kicked out immediately
  await RefreshToken.destroy({ where: { user_id: id } });

  return baseService.remove(User, MODEL_NAME, id, userId, companyId, { uniqueFields: ['email', 'username', 'phone', 'google_id', 'facebook_id'] });
};

/**
 * Update user status
 */
const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
  try {
    const user = await User.findByPk(id);
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (user.company_id && user.company_id !== companyId) {
        throw ApiError.notFound('User not found');
      }
    }

    const oldIsActive = user.is_active;
    const updateData = { updated_by: userId };
    if (is_active !== undefined) updateData.is_active = is_active;
    await user.update(updateData);

    // If deactivating or suspending, kick the user out of all active sessions immediately
    if (is_active !== 1 && oldIsActive === 1) {
      await RefreshToken.destroy({ where: { user_id: id } });
    }

    logger.logDB('updateStatus', MODEL_NAME, id);
    logger.logActivity(userId, 'update_status', MODEL_NAME, `Changed employee is_active from ${oldIsActive} to ${is_active}`, {
      recordId: id,
      oldIsActive,
      newIsActive: is_active,
      companyId,
    });

    // Send email notification based on status change
    try {
      if (is_active === 1 && oldIsActive !== 1) {
        await emailSenderService.sendEmail('account_activated', {
          to: user.email,
          variables: {
            user_name: user.full_name || 'User',
            app_url: process.env.CORS_ORIGIN || 'http://localhost:3000',
          },
        });
      } else if (is_active === 0) {
        await emailSenderService.sendEmail('account_deactivated', {
          to: user.email,
          variables: {
            user_name: user.full_name || 'User',
          },
        });
      }
    } catch (emailError) {
      logger.logError(emailError);
    }

    return user;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get user by email
 */
const getByEmail = async (email) => {
  try {
    return await User.findOne({
      where: { email },
      include: [{
        model: Role,
        as: 'role',
      }],
    });
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
  getByEmail,
};
