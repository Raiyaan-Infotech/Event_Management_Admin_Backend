const { Sequelize, Religion } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'Religion';
const MODULE_SLUG = 'religions';

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = ['name', 'description', 'icon', 'color', 'sort_order', 'is_active'];

const pickWritable = (data = {}) =>
    WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

const getAll = async (query = {}, companyId = undefined) => {
    // Default to sort_order so the list matches idx_religions_listing;
    // an explicit sort_by in the query still wins.
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    return baseService.getAll(Religion, MODEL_NAME, listQuery, {
        searchFields: ['name', 'description'],
        sortableFields: ['sort_order', 'name', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(Religion, MODEL_NAME, id, { companyId });
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Religion name is required');
    }
    payload.name = String(payload.name).trim();

    const nameExists = await Religion.findOne({
        where: { company_id: companyId ?? null, name: payload.name },
        attributes: ['id'],
    });
    if (nameExists) {
        throw ApiError.badRequest(`A religion named "${payload.name}" already exists.`);
    }

    return baseService.create(Religion, MODEL_NAME, payload, userId, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const religion = await Religion.findByPk(id);
    if (!religion) throw ApiError.notFound('Religion not found');

    const payload = pickWritable(data);

    if (payload.name !== undefined) {
        if (!String(payload.name).trim()) throw ApiError.badRequest('Religion name is required');
        payload.name = String(payload.name).trim();

        const nameExists = await Religion.findOne({
            where: {
                id: { [Op.ne]: id },
                company_id: companyId ?? religion.company_id,
                name: payload.name,
            },
            attributes: ['id'],
        });
        if (nameExists) {
            throw ApiError.badRequest(`A religion named "${payload.name}" already exists.`);
        }
    }

    return baseService.update(Religion, MODEL_NAME, id, payload, userId, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    return baseService.update(
        Religion,
        MODEL_NAME,
        id,
        { is_active: is_active ? 1 : 0 },
        userId,
        companyId
    );
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(Religion, MODEL_NAME, id, userId, companyId);
};

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
