const { Sequelize, NotificationCategory } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'NotificationCategory';
const MODULE_SLUG = 'notification_categories';

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = ['name', 'description', 'icon', 'color', 'sort_order', 'is_active'];

const pickWritable = (data = {}) =>
    WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

const getAll = async (query = {}, companyId = undefined) => {
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    return baseService.getAll(NotificationCategory, MODEL_NAME, listQuery, {
        searchFields: ['name', 'description'],
        sortableFields: ['sort_order', 'name', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(NotificationCategory, MODEL_NAME, id, { companyId });
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Category name is required');
    }
    payload.name = String(payload.name).trim();

    const nameExists = await NotificationCategory.findOne({
        where: { company_id: companyId ?? null, name: payload.name },
        attributes: ['id'],
    });
    if (nameExists) {
        throw ApiError.badRequest(`A notification category named "${payload.name}" already exists.`);
    }

    return baseService.create(NotificationCategory, MODEL_NAME, payload, userId, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const category = await NotificationCategory.findByPk(id);
    if (!category) throw ApiError.notFound('Notification category not found');

    const payload = pickWritable(data);

    if (payload.name !== undefined) {
        if (!String(payload.name).trim()) throw ApiError.badRequest('Category name is required');
        payload.name = String(payload.name).trim();

        const nameExists = await NotificationCategory.findOne({
            where: {
                id: { [Op.ne]: id },
                company_id: companyId ?? category.company_id,
                name: payload.name,
            },
            attributes: ['id'],
        });
        if (nameExists) {
            throw ApiError.badRequest(`A notification category named "${payload.name}" already exists.`);
        }
    }

    return baseService.update(NotificationCategory, MODEL_NAME, id, payload, userId, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    return baseService.update(
        NotificationCategory,
        MODEL_NAME,
        id,
        { is_active: is_active ? 1 : 0 },
        userId,
        companyId
    );
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(NotificationCategory, MODEL_NAME, id, userId, companyId);
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
