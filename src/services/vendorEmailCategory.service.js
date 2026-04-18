const { Op } = require('sequelize');
const { VendorEmailCategory } = require('../models');
const ApiError = require('../utils/apiError');

const getAll = async (vendorId, query = {}) => {
  const { page = 1, limit = 20, search = '', sort_by = 'sort_order', sort_order = 'ASC' } = query;
  const offset = (page - 1) * limit;

  const where = { vendor_id: vendorId };
  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { description: { [Op.like]: `%${search}%` } },
    ];
  }

  const { count, rows } = await VendorEmailCategory.findAndCountAll({
    where,
    order: [[sort_by, sort_order.toUpperCase()]],
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  return {
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit),
    },
  };
};

const getById = async (id, vendorId) => {
  const category = await VendorEmailCategory.findOne({ where: { id, vendor_id: vendorId } });
  if (!category) throw ApiError.notFound('Email category not found');
  return category;
};

const create = async (data, vendorId, companyId, userId) => {
  const exists = await VendorEmailCategory.findOne({
    where: { vendor_id: vendorId, name: data.name },
  });
  if (exists) throw ApiError.badRequest(`Category "${data.name}" already exists`);

  return VendorEmailCategory.create({
    vendor_id: vendorId,
    company_id: companyId || null,
    name: data.name,
    description: data.description || null,
    sort_order: data.sort_order || 0,
    is_active: data.is_active !== undefined ? data.is_active : 1,
    created_by: userId,
  });
};

const update = async (id, data, vendorId, userId) => {
  const category = await getById(id, vendorId);

  if (data.name && data.name !== category.name) {
    const exists = await VendorEmailCategory.findOne({
      where: { vendor_id: vendorId, name: data.name, id: { [Op.ne]: id } },
    });
    if (exists) throw ApiError.badRequest(`Category "${data.name}" already exists`);
  }

  await category.update({
    name: data.name ?? category.name,
    description: data.description !== undefined ? data.description : category.description,
    sort_order: data.sort_order !== undefined ? data.sort_order : category.sort_order,
    is_active: data.is_active !== undefined ? data.is_active : category.is_active,
    updated_by: userId,
  });

  return category;
};

const remove = async (id, vendorId, userId) => {
  const category = await getById(id, vendorId);
  await category.update({ deleted_by: userId });
  await category.destroy();
};

module.exports = { getAll, getById, create, update, remove };
