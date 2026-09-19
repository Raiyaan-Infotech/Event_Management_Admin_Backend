const { Sequelize, User, EventMenu, EventCategory, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const MODEL_NAME = 'EventMenu';

/**
 * A menu's per-platform Active switch decides whether a plan's grant reaches
 * that platform, and the portal caches those grants — so every save here drops
 * the cache. Required lazily: clientPortal.service is a heavier module.
 */
const invalidateGrants = () => require('./clientPortal.service').invalidatePlanGrants();
const MODULE_SLUG = 'event_menus';

// Whitelist, so a stray body key can never write company_id, created_by or an id.
//
// A menu is scoped by CATEGORY only — event type, religion and the
// Website/Mobile "menu type" were removed from the project. Which platform a
// menu shows on is decided by the PLAN's W/M switch in Manage Plan Menus.
const WRITABLE_FIELDS = [
    'name',
    'slug',
    'description',
    'remarks',
    'menu_group',
    'event_category_id',
    'active_website',
    'active_mobile',
    'icon',
    'color',
    'sort_order',
    'is_active',
];

// Only what the list and form render — no SELECT * on the joined tables.
const MENU_INCLUDE = [
    { model: EventCategory, as: 'category', attributes: ['id', 'name', 'color'], required: false },
];

const toBit = (value, fallback = 1) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return value ? 1 : 0;
    const s = String(value).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' ? 1 : 0;
};

const slugify = (value) =>
    String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const pickWritable = (data = {}) =>
    WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

const plainRow = (row) => (row && row.toJSON ? row.toJSON() : { ...row });

const numericFilter = (raw) => {
    if (raw === undefined || raw === null || raw === '' || raw === 'all') return undefined;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
};

/**
 * Slugs are unique per company. Rows here are soft-deleted, so the check runs
 * against live rows only and appends -2, -3… rather than failing the save.
 * Deliberately not a UNIQUE index: a deleted row would otherwise hold its slug
 * hostage forever.
 */
const buildUniqueSlug = async (base, companyId, excludeId = null) => {
    const root = slugify(base) || 'menu';

    const where = { slug: { [Op.like]: `${root}%` } };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;
    if (excludeId) where.id = { [Op.ne]: excludeId };

    const taken = new Set(
        (await EventMenu.findAll({ where, attributes: ['slug'], raw: true })).map((r) => r.slug)
    );

    if (!taken.has(root)) return root;
    for (let i = 2; i < 1000; i += 1) {
        if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
    }
    return `${root}-${Date.now()}`;
};

const getAll = async (query = {}, companyId = undefined) => {
    // Default to sort_order so the list matches idx_event_menus_listing;
    // an explicit sort_by in the query still wins.
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    const where = {};

    const categoryId = numericFilter(query.event_category_id);
    if (categoryId !== undefined) where.event_category_id = categoryId;

    // Core / Additional / Custom section filter — idx_event_menus_group
    if (query.menu_group && query.menu_group !== 'all') {
        where.menu_group = String(query.menu_group).toLowerCase();
    }

    const result = await baseService.getAll(EventMenu, MODEL_NAME, listQuery, {
        searchFields: ['name', 'slug'],
        sortableFields: ['sort_order', 'name', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: MENU_INCLUDE,
        where,
    });

    return { ...result, data: result.data.map(plainRow) };
};

/** Detail-only joins, so the view page can show Created By / Updated By. */
const AUDIT_INCLUDE = [
    { model: User, as: 'creator', attributes: ['id', 'full_name'], required: false },
    { model: User, as: 'updater', attributes: ['id', 'full_name'], required: false },
];

const getById = async (id, companyId = undefined) => {
    const menu = await baseService.getById(EventMenu, MODEL_NAME, id, {
        companyId,
        include: [...MENU_INCLUDE, ...AUDIT_INCLUDE],
    });
    return plainRow(menu);
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Menu name is required');
    }
    payload.name = String(payload.name).trim();

    payload.slug = await buildUniqueSlug(payload.slug || payload.name, companyId);

    const menu = await baseService.create(EventMenu, MODEL_NAME, payload, userId, companyId);
    return getById(menu.id, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const menu = await EventMenu.findByPk(id);
    if (!menu) throw ApiError.notFound('Menu not found');
    if (companyId !== undefined && companyId !== null && menu.company_id && menu.company_id !== companyId) {
        throw ApiError.notFound('Menu not found');
    }

    const payload = pickWritable(data);

    if (payload.name !== undefined) {
        if (!String(payload.name).trim()) throw ApiError.badRequest('Menu name is required');
        payload.name = String(payload.name).trim();
    }

    // Regenerate only when the slug was explicitly sent, or the name changed and
    // no slug was supplied. Editing an unrelated field must not silently
    // re-point a live URL.
    if (payload.slug !== undefined) {
        payload.slug = await buildUniqueSlug(payload.slug || payload.name || menu.name, companyId, menu.id);
    } else if (payload.name !== undefined && payload.name !== menu.name) {
        payload.slug = await buildUniqueSlug(payload.name, companyId, menu.id);
    }

    await baseService.update(EventMenu, MODEL_NAME, id, payload, userId, companyId);
    invalidateGrants();
    return getById(id, companyId);
};

/** Overall row status — the Status badge on the list. */
const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    await baseService.update(EventMenu, MODEL_NAME, id, { is_active: toBit(is_active, 1) }, userId, companyId);
    return getById(id, companyId);
};

/**
 * One endpoint for the per-platform Active switches, so a switch flip writes a
 * single column instead of round-tripping the whole row.
 * The field name is checked against this whitelist, so the route's `:field`
 * cannot be used to write an arbitrary column.
 */
const TOGGLE_FIELDS = ['active_website', 'active_mobile'];

const updateToggle = async (id, field, value, userId = null, companyId = undefined) => {
    if (!TOGGLE_FIELDS.includes(field)) {
        throw ApiError.badRequest(`Unknown toggle "${field}".`);
    }
    await baseService.update(EventMenu, MODEL_NAME, id, { [field]: toBit(value, 1) }, userId, companyId);
    invalidateGrants();
    return getById(id, companyId);
};

/** Action-menu "Duplicate" — copies the row, appends (Copy), fresh slug. */
const duplicate = async (id, userId = null, companyId = undefined) => {
    const source = await EventMenu.findByPk(id);
    if (!source) throw ApiError.notFound('Menu not found');
    if (companyId !== undefined && companyId !== null && source.company_id && source.company_id !== companyId) {
        throw ApiError.notFound('Menu not found');
    }

    const src = source.toJSON();
    const payload = WRITABLE_FIELDS.reduce((acc, key) => {
        if (src[key] !== undefined) acc[key] = src[key];
        return acc;
    }, {});

    payload.name = `${src.name} (Copy)`;
    payload.slug = await buildUniqueSlug(payload.name, companyId);

    const menu = await baseService.create(EventMenu, MODEL_NAME, payload, userId, companyId);
    return getById(menu.id, companyId);
};

/**
 * Action-menu "Change Order". Written in one transaction: a half-applied reorder
 * leaves two rows claiming the same position, and the list would then paginate
 * non-deterministically.
 */
const reorder = async (items = [], userId = null, companyId = undefined) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw ApiError.badRequest('Provide an array of { id, sort_order }.');
    }

    const ids = items.map((i) => parseInt(i.id, 10)).filter((n) => !Number.isNaN(n));

    const where = { id: ids };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const owned = await EventMenu.findAll({ where, attributes: ['id'], raw: true });
    const ownedIds = new Set(owned.map((r) => r.id));

    await sequelize.transaction(async (transaction) => {
        for (const item of items) {
            const id = parseInt(item.id, 10);
            if (!ownedIds.has(id)) continue;
            await EventMenu.update(
                { sort_order: parseInt(item.sort_order, 10) || 0, updated_by: userId },
                { where: { id }, transaction }
            );
        }
    });

    await logger.logActivity(userId, 'update', MODEL_NAME, `Reordered ${ownedIds.size} menus`, { companyId });
    return { updated: ownedIds.size };
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(EventMenu, MODEL_NAME, id, userId, companyId);
};

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    updateToggle,
    duplicate,
    reorder,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
