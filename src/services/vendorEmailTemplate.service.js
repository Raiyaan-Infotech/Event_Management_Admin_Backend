const { Op } = require('sequelize');
const { VendorEmailTemplate, VendorEmailCategory } = require('../models');
const ApiError = require('../utils/apiError');

const getAll = async (vendorId, query = {}) => {
  const {
    page = 1,
    limit = 10,
    search = '',
    category_id,
    sort_by = 'createdAt',
    sort_order = 'DESC',
  } = query;
  const offset = (page - 1) * limit;

  const where = { vendor_id: vendorId };
  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
    ];
  }
  if (category_id) {
    where.category_id = category_id;
  }

  const { count, rows } = await VendorEmailTemplate.findAndCountAll({
    where,
    include: [
      {
        model: VendorEmailCategory,
        as: 'category',
        attributes: ['id', 'name'],
      },
    ],
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
  const template = await VendorEmailTemplate.findOne({
    where: { id, vendor_id: vendorId },
    include: [
      {
        model: VendorEmailCategory,
        as: 'category',
        attributes: ['id', 'name'],
      },
    ],
  });
  if (!template) throw ApiError.notFound('Email template not found');
  return template;
};

const create = async (data, vendorId, companyId, userId) => {
  if (data.category_id) {
    const cat = await VendorEmailCategory.findOne({
      where: { id: data.category_id, vendor_id: vendorId },
    });
    if (!cat) throw ApiError.badRequest('Invalid category');
  }

  const template = await VendorEmailTemplate.create({
    vendor_id: vendorId,
    company_id: companyId || null,
    category_id: data.category_id || null,
    name: data.name,
    description: data.description || null,
    is_active: data.is_active !== undefined ? data.is_active : 1,
    created_by: userId,
  });

  return getById(template.id, vendorId);
};

const update = async (id, data, vendorId, userId) => {
  const template = await getById(id, vendorId);

  if (data.category_id && data.category_id !== template.category_id) {
    const cat = await VendorEmailCategory.findOne({
      where: { id: data.category_id, vendor_id: vendorId },
    });
    if (!cat) throw ApiError.badRequest('Invalid category');
  }

  await template.update({
    category_id: data.category_id !== undefined ? data.category_id : template.category_id,
    name: data.name ?? template.name,
    description: data.description !== undefined ? data.description : template.description,
    is_active: data.is_active !== undefined ? data.is_active : template.is_active,
  });

  return getById(id, vendorId);
};

const updateStatus = async (id, vendorId, userId) => {
  const template = await getById(id, vendorId);
  await template.update({ is_active: template.is_active ? 0 : 1 });
  return template;
};

const remove = async (id, vendorId, userId) => {
  const template = await getById(id, vendorId);
  await template.update({ deleted_by: userId });
  await template.destroy();
};

module.exports = { getAll, getById, create, update, updateStatus, remove };
