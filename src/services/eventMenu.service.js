const { Sequelize, EventMenu, EventCategory, EventType, Religion, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const MODEL_NAME = 'EventMenu';
const MODULE_SLUG = 'event_menus';

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = [
    'name',
    'slug',
    'menu_group',
    'event_category_id',
    'event_type_id',
    'religion_id',
    'is_website',
    'is_mobile',
    'display_website',
    'display_mobile',
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
    { model: EventType, as: 'eventType', attributes: ['id', 'name', 'color'], required: false },
    { model: Religion, as: 'religion', attributes: ['id', 'name', 'color'], required: false },
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

/**
 * The API speaks `menu_type: ['website','mobile']` — what the form's multi-select
 * produces — while the table stores two indexed booleans (a SET column could not
 * use an index for the list's menu-type filter). Both directions live here so
 * nothing else has to know about the split.
 */
const applyMenuType = (payload, data) => {
    if (data.menu_type === undefined) return payload;

    const list = Array.isArray(data.menu_type) ? data.menu_type : String(data.menu_type).split(',');
    const selected = new Set(list.map((v) => String(v).trim().toLowerCase()).filter(Boolean));

    payload.is_website = selected.has('website') ? 1 : 0;
    payload.is_mobile =
        selected.has('mobile') || selected.has('mobile_app') || selected.has('mobileapp') ? 1 : 0;

    return payload;
};

const withMenuType = (row) => {
    const plain = row && row.toJSON ? row.toJSON() : { ...row };
    const types = [];
    if (plain.is_website) types.push('website');
    if (plain.is_mobile) types.push('mobile');
    plain.menu_type = types;
    return plain;
};

const pickWritable = (data = {}) => {
    const payload = WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});
    return applyMenuType(payload, data);
};

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

/**
 * A menu's event type must belong to its event category, or the list shows a row
 * whose Event Type contradicts its Event Category.
 */
const assertTypeMatchesCategory = async (categoryId, typeId, companyId) => {
    if (!typeId || !categoryId) return;

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

/**
 * Religions are scoped under (category, type) too, so the chosen religion has
 * to sit under the menu's own scope — otherwise the Menu List would show a
 * religion that its own cascade could never offer.
 *
 * The column stays nullable in the DB: existing menus predate this rule, and
 * the mockup's list legitimately shows "—" for non-religious events. "Required"
 * is enforced here on write, not by the schema, so it stays reversible.
 */
const assertReligionMatchesScope = async (categoryId, typeId, religionId, companyId) => {
    if (!religionId) throw ApiError.badRequest('Religion is required.');

    const religion = await Religion.findByPk(religionId, {
        attributes: ['id', 'event_category_id', 'event_type_id', 'company_id'],
    });
    if (!religion) throw ApiError.badRequest('Selected religion does not exist.');

    if (companyId !== undefined && companyId !== null && religion.company_id && religion.company_id !== companyId) {
        throw ApiError.badRequest('Selected religion does not exist.');
    }
    if (categoryId && Number(religion.event_category_id) !== Number(categoryId)) {
        throw ApiError.badRequest('The selected religion does not belong to the selected event category.');
    }
    if (typeId && Number(religion.event_type_id) !== Number(typeId)) {
        throw ApiError.badRequest('The selected religion does not belong to the selected event type.');
    }
};

const getAll = async (query = {}, companyId = undefined) => {
    // Default to sort_order so the list matches idx_event_menus_listing;
    // an explicit sort_by in the query still wins.
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    const where = {};

    const categoryId = numericFilter(query.event_category_id);
    if (categoryId !== undefined) where.event_category_id = categoryId;

    const typeId = numericFilter(query.event_type_id);
    if (typeId !== undefined) where.event_type_id = typeId;

    const religionId = numericFilter(query.religion_id);
    if (religionId !== undefined) where.religion_id = religionId;

    // Core / Additional / Custom section filter — idx_event_menus_group
    if (query.menu_group && query.menu_group !== 'all') {
        where.menu_group = String(query.menu_group).toLowerCase();
    }

    // menu_type=website|mobile — indexed via idx_event_menus_platform
    if (query.menu_type && query.menu_type !== 'all') {
        const t = String(query.menu_type).toLowerCase();
        if (t === 'website') where.is_website = 1;
        else if (t === 'mobile' || t === 'mobile_app') where.is_mobile = 1;
    }

    const result = await baseService.getAll(EventMenu, MODEL_NAME, listQuery, {
        searchFields: ['name', 'slug'],
        sortableFields: ['sort_order', 'name', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: MENU_INCLUDE,
        where,
    });

    return { ...result, data: result.data.map(withMenuType) };
};

const getById = async (id, companyId = undefined) => {
    const menu = await baseService.getById(EventMenu, MODEL_NAME, id, {
        companyId,
        include: MENU_INCLUDE,
    });
    return withMenuType(menu);
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Menu name is required');
    }
    payload.name = String(payload.name).trim();

    if (!payload.is_website && !payload.is_mobile) {
        throw ApiError.badRequest('Select at least one menu type (Website or Mobile App).');
    }

    await assertTypeMatchesCategory(payload.event_category_id, payload.event_type_id, companyId);
    await assertReligionMatchesScope(
        payload.event_category_id,
        payload.event_type_id,
        payload.religion_id,
        companyId
    );

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

    // Only validated when the request actually touches menu type — a PATCH that
    // just flips a display toggle must not be rejected for not resending it.
    if (payload.is_website !== undefined || payload.is_mobile !== undefined) {
        const website = payload.is_website ?? menu.is_website;
        const mobile = payload.is_mobile ?? menu.is_mobile;
        if (!website && !mobile) {
            throw ApiError.badRequest('Select at least one menu type (Website or Mobile App).');
        }
    }

    const nextCategoryId = payload.event_category_id ?? menu.event_category_id;
    const nextTypeId = payload.event_type_id ?? menu.event_type_id;
    await assertTypeMatchesCategory(nextCategoryId, nextTypeId, companyId);

    // Only revalidate the religion when the request touches the scope or the
    // religion itself. A PATCH flipping one display toggle must not be rejected
    // because a pre-existing menu has no religion yet.
    const touchesScope = payload.event_category_id !== undefined
        || payload.event_type_id !== undefined
        || payload.religion_id !== undefined;

    if (touchesScope) {
        await assertReligionMatchesScope(
            nextCategoryId,
            nextTypeId,
            payload.religion_id ?? menu.religion_id,
            companyId
        );
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
    return getById(id, companyId);
};

/** Overall row status — the Status badge on the list. */
const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    await baseService.update(EventMenu, MODEL_NAME, id, { is_active: toBit(is_active, 1) }, userId, companyId);
    return getById(id, companyId);
};

/**
 * One endpoint for the four per-platform switches on the list screen, so a
 * switch flip writes a single column instead of round-tripping the whole row.
 * The field name is checked against this whitelist, so the route's `:field`
 * cannot be used to write an arbitrary column.
 */
const TOGGLE_FIELDS = ['display_website', 'display_mobile', 'active_website', 'active_mobile'];

const updateToggle = async (id, field, value, userId = null, companyId = undefined) => {
    if (!TOGGLE_FIELDS.includes(field)) {
        throw ApiError.badRequest(`Unknown toggle "${field}".`);
    }
    await baseService.update(EventMenu, MODEL_NAME, id, { [field]: toBit(value, 1) }, userId, companyId);
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
