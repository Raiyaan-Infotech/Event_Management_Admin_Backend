const { Department, User } = require('../models');
const { Op } = require('sequelize');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const MODEL_NAME = 'Department';

const getAll = async (query = {}, companyId = undefined) => {
    const page   = parseInt(query.page)  || 1;
    const limit  = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = query.search || '';

    const where = {};
    if (companyId !== undefined && companyId !== null) {
        where.company_id = companyId;
    }
    if (search) {
        where[Op.or] = [
            { name:        { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
        ];
    }
    if (query.is_active !== undefined) where.is_active = query.is_active;

    const { count, rows } = await Department.findAndCountAll({
        where,
        limit,
        offset,
        order: [['name', 'ASC']],
    });

    return {
        data: rows,
        pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
    };
};

const getById = async (id, companyId = undefined) => {
    const where = { id };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const dept = await Department.findOne({ where });
    if (!dept) throw ApiError.notFound('Department not found');
    return dept;
};

const create = async (data, companyId = undefined) => {
    if (!data.name?.trim()) throw ApiError.badRequest('Department name is required');

    const where = { name: data.name.trim() };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const existing = await Department.findOne({ where });
    if (existing) throw ApiError.conflict('A department with this name already exists');

    const dept = await Department.create({
        name:        data.name.trim(),
        description: data.description?.trim() || null,
        company_id:  companyId || null,
        is_active:   1,
    });

    logger.logDB('create', MODEL_NAME, dept.id);
    return dept;
};

const update = async (id, data, companyId = undefined) => {
    const where = { id };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const dept = await Department.findOne({ where });
    if (!dept) throw ApiError.notFound('Department not found');

    if (data.name && data.name.trim() !== dept.name) {
        const dupWhere = { name: data.name.trim(), id: { [Op.ne]: id } };
        if (companyId !== undefined && companyId !== null) dupWhere.company_id = companyId;
        const existing = await Department.findOne({ where: dupWhere });
        if (existing) throw ApiError.conflict('A department with this name already exists');
    }

    await dept.update({
        name:        data.name !== undefined        ? data.name.trim()                  : dept.name,
        description: data.description !== undefined ? (data.description?.trim() || null) : dept.description,
        is_active:   data.is_active !== undefined   ? data.is_active                    : dept.is_active,
    });

    logger.logDB('update', MODEL_NAME, id);
    return dept;
};

const remove = async (id, companyId = undefined) => {
    const where = { id };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const dept = await Department.findOne({ where });
    if (!dept) throw ApiError.notFound('Department not found');

    // Unlink employees before delete
    await User.update({ department_id: null }, { where: { department_id: id } });

    await dept.destroy();
    logger.logDB('delete', MODEL_NAME, id);
};

module.exports = { getAll, getById, create, update, remove };
