const { Sequelize, Religion, EventCategory, EventType } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'Religion';
const MODULE_SLUG = 'religions';

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = [
    'event_category_id',
    'event_type_id',
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

// Only the columns the list renders — the scope names and their colour chips.
const SCOPE_INCLUDE = [
    { model: EventCategory, as: 'category', attributes: ['id', 'name', 'color'], required: false },
    { model: EventType, as: 'eventType', attributes: ['id', 'name', 'color'], required: false },
];

const numericFilter = (raw) => {
    if (raw === undefined || raw === null || raw === '' || raw === 'all') return undefined;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
};

/**
 * A religion sits under one event type, and that type must belong to the given
 * category — otherwise the row contradicts itself and the Menu form's cascade
 * would never surface it.
 */
const assertScopeValid = async (categoryId, typeId, companyId) => {
    if (!categoryId) throw ApiError.badRequest('Event category is required');
    if (!typeId) throw ApiError.badRequest('Event type is required');

    const category = await EventCategory.findByPk(categoryId, { attributes: ['id', 'company_id'] });
    if (!category) throw ApiError.badRequest('Selected event category does not exist.');
    if (companyId !== undefined && companyId !== null && category.company_id && category.company_id !== companyId) {
        throw ApiError.badRequest('Selected event category does not exist.');
    }

    const eventType = await EventType.findByPk(typeId, {
        attributes: ['id', 'event_category_id', 'company_id'],
    });
    if (!eventType) throw ApiError.badRequest('Selected event type does not exist.');
    if (companyId !== undefined && companyId !== null && eventType.company_id && eventType.company_id !== companyId) {
        throw ApiError.badRequest('Selected event type does not exist.');
    }
    if (Number(eventType.event_category_id) !== Number(categoryId)) {
        throw ApiError.badRequest('The selected event type does not belong to the selected event category.');
    }
};

const getAll = async (query = {}, companyId = undefined) => {
    // Default to sort_order so the list matches idx_religions_listing;
    // an explicit sort_by in the query still wins.
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    // The Menu form re-reads religions for the chosen category+type on every
    // change, so these are real WHEREs (idx_religions_scope), not client-side.
    const where = {};
    const categoryId = numericFilter(query.event_category_id);
    if (categoryId !== undefined) where.event_category_id = categoryId;

    const typeId = numericFilter(query.event_type_id);
    if (typeId !== undefined) where.event_type_id = typeId;

    return baseService.getAll(Religion, MODEL_NAME, listQuery, {
        searchFields: ['name', 'description'],
        sortableFields: ['sort_order', 'name', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: SCOPE_INCLUDE,
        where,
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(Religion, MODEL_NAME, id, {
        companyId,
        include: SCOPE_INCLUDE,
    });
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Religion name is required');
    }
    payload.name = String(payload.name).trim();

    await assertScopeValid(payload.event_category_id, payload.event_type_id, companyId);

    // Scoped to the event type: "Hindu" under a Hindu Wedding and under a
    // Birthday are two legitimately separate rows.
    const nameExists = await Religion.findOne({
        where: {
            company_id: companyId ?? null,
            event_type_id: payload.event_type_id,
            name: payload.name,
        },
        attributes: ['id'],
    });
    if (nameExists) {
        throw ApiError.badRequest(`A religion named "${payload.name}" already exists for this event type.`);
    }

    return baseService.create(Religion, MODEL_NAME, payload, userId, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const religion = await Religion.findByPk(id);
    if (!religion) throw ApiError.notFound('Religion not found');

    const payload = pickWritable(data);

    // Validate whenever either half of the scope is touched — changing only the
    // type could otherwise leave it pointing outside the stored category.
    if (payload.event_category_id !== undefined || payload.event_type_id !== undefined) {
        await assertScopeValid(
            payload.event_category_id ?? religion.event_category_id,
            payload.event_type_id ?? religion.event_type_id,
            companyId
        );
    }

    if (payload.name !== undefined) {
        if (!String(payload.name).trim()) throw ApiError.badRequest('Religion name is required');
        payload.name = String(payload.name).trim();

        const nameExists = await Religion.findOne({
            where: {
                id: { [Op.ne]: id },
                company_id: companyId ?? religion.company_id,
                event_type_id: payload.event_type_id ?? religion.event_type_id,
                name: payload.name,
            },
            attributes: ['id'],
        });
        if (nameExists) {
            throw ApiError.badRequest(`A religion named "${payload.name}" already exists for this event type.`);
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
