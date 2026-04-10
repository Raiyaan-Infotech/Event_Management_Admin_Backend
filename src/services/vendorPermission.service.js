const { Module, Permission } = require('../models');

/**
 * Get all global modules with their permissions (for vendor view)
 */
const getModules = async () => {
  const modules = await Module.findAll({
    where: { vendor_id: null, is_active: 1 },
    include: [{
      model: Permission,
      as: 'permissions',
      where: { vendor_id: null, is_active: 1 },
      required: false,
    }],
    order: [['name', 'ASC']],
  });

  return modules;
};

/**
 * Get all global permissions (flat list)
 */
const getPermissions = async () => {
  const permissions = await Permission.findAll({
    where: { company_id: null, vendor_id: null, is_active: 1 },
    include: [{
      model: Module,
      as: 'moduleRef',
      attributes: ['id', 'name', 'slug'],
    }],
    order: [['module', 'ASC'], ['name', 'ASC']],
  });

  return permissions;
};

module.exports = { getModules, getPermissions };
