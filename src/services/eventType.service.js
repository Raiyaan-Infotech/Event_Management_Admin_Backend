const { Sequelize, EventType, EventCategory } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'EventType';
const MODULE_SLUG = 'event_types';

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = [
    'event_category_id',
    'name',
    'description',
    'icon',
    'color',
    'sort_order',
    'is_active',
];

const pickWritable = (data = {}) =>
    WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

// Only the two columns the list renders — the category name and its colour chip.
// Pulling the whole category row per type is wasted bytes on every page load.
const CATEGORY_INCLUDE = [
    {
        model: EventCategory,
        as: 'category',
        attributes: ['id', 'name', 'color'],
        required: false,
    },
];

const getAll = async (query = {}, companyId = undefined) => {
    // Default to sort_order so the list matches idx_event_types_listing;
    // an explicit sort_by in the query still wins.
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    // The Menu form re-reads this list every time the category changes, so the
    // filter has to be a real WHERE (hits idx_event_types_category), not a
    // client-side filter over every type in the company.
    const where = {};
    const rawCategoryId = query.event_category_id;
    if (rawCategoryId !== undefined && rawCategoryId !== null && rawCategoryId !== '' && rawCategoryId !== 'all') {
        const categoryId = parseInt(rawCategoryId, 10);
        if (!Number.isNaN(categoryId)) where.event_category_id = categoryId;
    }

    return baseService.getAll(EventType, MODEL_NAME, listQuery, {
        searchFields: ['name', 'description'],
        sortableFields: ['sort_order', 'name', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: CATEGORY_INCLUDE,
        where,
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(EventType, MODEL_NAME, id, {
        companyId,
        include: CATEGORY_INCLUDE,
    });
};

/** A type must sit under a category that exists and belongs to this company. */
const assertCategoryExists = async (categoryId, companyId) => {
    if (!categoryId) throw ApiError.badRequest('Event category is required');

    const category = await EventCategory.findByPk(categoryId, {
        attributes: ['id', 'company_id'],
    });
    if (!category) throw ApiError.badRequest('Selected event category does not exist.');

    if (companyId !== undefined && companyId !== null && category.company_id && category.company_id !== companyId) {
        throw ApiError.badRequest('Selected event category does not exist.');
    }
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Event type name is required');
    }
    payload.name = String(payload.name).trim();

    await assertCategoryExists(payload.event_category_id, companyId);

    // Scoped to the category: "Reception" under Wedding and under Corporate are
    // two legitimately different types.
    const nameExists = await EventType.findOne({
        where: {
            company_id: companyId ?? null,
            event_category_id: payload.event_category_id,
            name: payload.name,
        },
        attributes: ['id'],
    });
    if (nameExists) {
        throw ApiError.badRequest(`An event type named "${payload.name}" already exists in this category.`);
    }

    return baseService.create(EventType, MODEL_NAME, payload, userId, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const eventType = await EventType.findByPk(id);
    if (!eventType) throw ApiError.notFound('Event type not found');

    const payload = pickWritable(data);

    if (payload.event_category_id !== undefined) {
        await assertCategoryExists(payload.event_category_id, companyId);
    }

    if (payload.name !== undefined) {
        if (!String(payload.name).trim()) throw ApiError.badRequest('Event type name is required');
        payload.name = String(payload.name).trim();

        const nameExists = await EventType.findOne({
            where: {
                id: { [Op.ne]: id },
                company_id: companyId ?? eventType.company_id,
                event_category_id: payload.event_category_id ?? eventType.event_category_id,
                name: payload.name,
            },
            attributes: ['id'],
        });
        if (nameExists) {
            throw ApiError.badRequest(`An event type named "${payload.name}" already exists in this category.`);
        }
    }

    return baseService.update(EventType, MODEL_NAME, id, payload, userId, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    return baseService.update(
        EventType,
        MODEL_NAME,
        id,
        { is_active: is_active ? 1 : 0 },
        userId,
        companyId
    );
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(EventType, MODEL_NAME, id, userId, companyId);
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
