const { VendorDepartment } = require('../models');
const { Op } = require('sequelize');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const MODEL_NAME = 'VendorDepartment';

const getAll = async (query = {}, vendorId) => {
    const page   = parseInt(query.page)  || 1;
    const limit  = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = query.search || '';

    const where = { vendor_id: vendorId };
    if (search) {
        where[Op.or] = [
            { name:        { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
        ];
    }
    if (query.is_active !== undefined) where.is_active = query.is_active;

    const { count, rows } = await VendorDepartment.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'DESC']],
    });

    return {
        data: rows,
        pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
    };
};

const getById = async (id, vendorId) => {
    const dept = await VendorDepartment.findOne({ where: { id, vendor_id: vendorId } });
    if (!dept) throw ApiError.notFound('Department not found');
    return dept;
};

const create = async (data, vendorId, companyId) => {
    if (!data.name?.trim()) throw ApiError.badRequest('Department name is required');

    const existing = await VendorDepartment.findOne({
        where: { name: data.name.trim(), vendor_id: vendorId },
    });
    if (existing) throw ApiError.conflict('A department with this name already exists');

    const dept = await VendorDepartment.create({
        name:        data.name.trim(),
        description: data.description?.trim() || null,
        vendor_id:   vendorId,
        company_id:  companyId || null,
        is_active:   1,
    });

    logger.logDB('create', MODEL_NAME, dept.id);
    return dept;
};

const update = async (id, data, vendorId) => {
    const dept = await VendorDepartment.findOne({ where: { id, vendor_id: vendorId } });
    if (!dept) throw ApiError.notFound('Department not found');

    if (data.name && data.name.trim() !== dept.name) {
        const existing = await VendorDepartment.findOne({
            where: { name: data.name.trim(), vendor_id: vendorId, id: { [Op.ne]: id } },
        });
        if (existing) throw ApiError.conflict('A department with this name already exists');
    }

    await dept.update({
        name:        data.name !== undefined        ? data.name.trim()              : dept.name,
        description: data.description !== undefined ? (data.description?.trim() || null) : dept.description,
        is_active:   data.is_active !== undefined   ? data.is_active                : dept.is_active,
    });

    logger.logDB('update', MODEL_NAME, id);
    return dept;
};

const remove = async (id, vendorId) => {
    const dept = await VendorDepartment.findOne({ where: { id, vendor_id: vendorId } });
    if (!dept) throw ApiError.notFound('Department not found');
    await dept.destroy();
    logger.logDB('delete', MODEL_NAME, id);
};

module.exports = { getAll, getById, create, update, remove };
