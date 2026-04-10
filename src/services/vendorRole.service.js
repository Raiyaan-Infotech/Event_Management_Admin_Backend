const { Role, Permission, RolePermission, VendorStaff } = require('../models');
const { Op } = require('sequelize');
const ApiError = require('../utils/apiError');
const { generateSlug } = require('../utils/helpers');
const logger = require('../utils/logger');

const MODEL_NAME = 'VendorRole';

/**
 * Get all roles for a vendor with pagination
 */
const getAll = async (query = {}, vendorId) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const offset = (page - 1) * limit;
  const search = query.search || '';

  const where = { vendor_id: vendorId };
  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { slug: { [Op.like]: `%${search}%` } },
    ];
  }

  const { count, rows } = await Role.findAndCountAll({
    where,
    limit,
    offset,
    order: [['created_at', 'DESC']],
    include: [{
      model: Permission,
      as: 'permissions',
      through: { attributes: ['requires_approval'] },
    }],
  });

  return {
    data: rows,
    pagination: {
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    },
  };
};

/**
 * Get role by ID with permissions
 */
const getById = async (id, vendorId) => {
  const role = await Role.findOne({
    where: { id, vendor_id: vendorId },
    include: [{
      model: Permission,
      as: 'permissions',
      through: { attributes: ['requires_approval'] },
    }],
  });

  if (!role) throw ApiError.notFound('Role not found');
  return role;
};

/**
 * Create a new vendor role
 */
const create = async (data, vendorId) => {
  if (!data.slug) {
    data.slug = generateSlug(data.name);
  }

  const existing = await Role.findOne({
    where: { slug: data.slug, vendor_id: vendorId },
  });
  if (existing) throw ApiError.conflict('Role with this name already exists');

  const role = await Role.create({
    name: data.name,
    slug: data.slug,
    description: data.description || null,
    level: 10, // custom level only — vendor-created roles are always custom (not developer/admin)
    vendor_id: vendorId,
    is_active: 1,
  });

  logger.logDB('create', MODEL_NAME, role.id);
  return getById(role.id, vendorId);
};

/**
 * Update a vendor role
 */
const update = async (id, data, vendorId) => {
  const role = await Role.findOne({ where: { id, vendor_id: vendorId } });
  if (!role) throw ApiError.notFound('Role not found');

  if (data.name && !data.slug) {
    data.slug = generateSlug(data.name);
  }

  if (data.slug && data.slug !== role.slug) {
    const existing = await Role.findOne({
      where: { slug: data.slug, vendor_id: vendorId, id: { [Op.ne]: id } },
    });
    if (existing) throw ApiError.conflict('Role with this name already exists');
  }

  await role.update({
    name: data.name !== undefined ? data.name : role.name,
    slug: data.slug || role.slug,
    description: data.description !== undefined ? data.description : role.description,
    is_active: data.is_active !== undefined ? data.is_active : role.is_active,
    // level is intentionally not updatable — always stays at 10 (custom)
  });

  logger.logDB('update', MODEL_NAME, id);
  return getById(id, vendorId);
};

/**
 * Delete a vendor role (soft delete)
 */
const remove = async (id, vendorId) => {
  const role = await Role.findOne({ where: { id, vendor_id: vendorId } });
  if (!role) throw ApiError.notFound('Role not found');

  const assignedCount = await VendorStaff.count({ where: { role_id: id } });
  if (assignedCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete role: ${assignedCount} staff member${assignedCount > 1 ? 's are' : ' is'} still assigned. Reassign them first.`
    );
  }

  await role.destroy();
  logger.logDB('delete', MODEL_NAME, id);
};

/**
 * Assign permissions to a vendor role
 */
const assignPermissions = async (id, permissionsData, vendorId) => {
  const role = await Role.findOne({ where: { id, vendor_id: vendorId } });
  if (!role) throw ApiError.notFound('Role not found');

  const permissionIds = permissionsData.map(p =>
    typeof p === 'object' ? (p.permission_id || p.id) : p
  );

  // Validate all permissions exist (global permissions where vendor_id IS NULL)
  const permissions = await Permission.findAll({
    where: {
      id: permissionIds,
      [Op.or]: [{ vendor_id: null }, { vendor_id: vendorId }],
    },
  });

  if (permissions.length !== permissionIds.length) {
    throw ApiError.badRequest('Some permissions are invalid');
  }

  // Hard delete existing, then bulk create new
  await RolePermission.destroy({ where: { role_id: id }, force: true });

  const rolePermissions = permissionsData.map(p => {
    const permissionId = typeof p === 'object' ? (p.permission_id || p.id) : p;
    const requiresApproval = typeof p === 'object' ? (p.requires_approval || false) : false;

    return {
      role_id: id,
      permission_id: permissionId,
      vendor_id: vendorId,
      requires_approval: requiresApproval,
    };
  });

  await RolePermission.bulkCreate(rolePermissions);

  logger.logDB('assignPermissions', MODEL_NAME, id);
  return getById(id, vendorId);
};

module.exports = { getAll, getById, create, update, remove, assignPermissions };
