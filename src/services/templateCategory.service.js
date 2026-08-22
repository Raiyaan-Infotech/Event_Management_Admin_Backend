const { Sequelize, TemplateCategory, FrameStyle, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'TemplateCategory';
const MODULE_SLUG = 'template_categories';

/**
 * Template categories — the design family a template or a frame belongs to.
 *
 * Two fields carry all of it: `name` is what a person reads, `slug` is what a
 * filter or a URL addresses. Everything else on the row is the housekeeping
 * every module here has.
 */

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = ['name', 'slug', 'sort_order', 'is_active'];

const slugify = (value) =>
    String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const toBit = (value, fallback = 1) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return value ? 1 : 0;
    const s = String(value).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' ? 1 : 0;
};

const clampInt = (raw, min, max, fallback) => {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(Math.max(n, min), max);
};

/**
 * Unique per company, checked against LIVE rows only.
 *
 * Deliberately not a UNIQUE index: rows here are soft-deleted, and a unique
 * index counts deleted rows — so one deleted "floral" would hold that slug
 * hostage forever. Appends -2, -3… rather than failing the save, which is the
 * same rule `event_templates.code` follows.
 */
const buildUniqueSlug = async (base, companyId, excludeId = null) => {
    const root = slugify(base) || 'category';

    const where = { slug: { [Op.like]: `${root}%` } };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;
    if (excludeId) where.id = { [Op.ne]: excludeId };

    const taken = new Set(
        (await TemplateCategory.findAll({ where, attributes: ['slug'], raw: true })).map((r) => r.slug)
    );

    if (!taken.has(root)) return root;
    for (let i = 2; i < 1000; i += 1) {
        if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
    }
    return `${root}-${Date.now()}`;
};

const pickWritable = (data = {}) => {
    const payload = WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

    if (payload.name !== undefined) payload.name = String(payload.name ?? '').trim().slice(0, 150);
    if (payload.is_active !== undefined) payload.is_active = toBit(payload.is_active, 1);
    if (payload.sort_order !== undefined) payload.sort_order = clampInt(payload.sort_order, 0, 999999, 0);

    return payload;
};

/**
 * How many frame styles sit in each category.
 *
 * One grouped query for the whole page rather than a COUNT per row: at ~374ms a
 * round trip to production, ten rows would be ten extra trips on a list that has
 * already loaded.
 */
const frameCountsByCategory = async (categoryIds = []) => {
    if (!categoryIds.length) return {};

    const rows = await FrameStyle.findAll({
        where: { template_category_id: categoryIds },
        attributes: [
            'template_category_id',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        ],
        group: ['template_category_id'],
        raw: true,
    });

    return rows.reduce((acc, row) => {
        acc[row.template_category_id] = Number(row.count) || 0;
        return acc;
    }, {});
};

const getAll = async (query = {}, companyId = undefined) => {
    // Sorted by sort_order to match idx_template_categories_listing; an explicit
    // sort_by in the query still wins.
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    const where = {};
    if (query.is_active !== undefined && query.is_active !== '' && query.is_active !== 'all') {
        where.is_active = toBit(query.is_active, 1);
    }

    // baseService's own `status` handling would try to match this against a
    // `status` column, which this table does not have.
    const { status, ...restQuery } = listQuery;

    const result = await baseService.getAll(TemplateCategory, MODEL_NAME, restQuery, {
        searchFields: ['name', 'slug'],
        sortableFields: ['sort_order', 'name', 'slug', 'created_at', 'updated_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        where,
    });

    const counts = await frameCountsByCategory(result.data.map((r) => r.id));

    return {
        ...result,
        data: result.data.map((row) => {
            const plain = row && row.toJSON ? row.toJSON() : { ...row };
            plain.frame_styles_count = counts[plain.id] ?? 0;
            return plain;
        }),
    };
};

const getById = async (id, companyId = undefined) =>
    baseService.getById(TemplateCategory, MODEL_NAME, id, { companyId });

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name) throw ApiError.badRequest('Category name is required.');

    payload.slug = await buildUniqueSlug(payload.slug || payload.name, companyId);

    const created = await baseService.create(TemplateCategory, MODEL_NAME, payload, userId, companyId);
    return getById(created.id, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const category = await TemplateCategory.findByPk(id);
    if (!category) throw ApiError.notFound('Category not found');
    if (companyId !== undefined && companyId !== null && category.company_id && category.company_id !== companyId) {
        throw ApiError.notFound('Category not found');
    }

    const payload = pickWritable(data);

    if (payload.name !== undefined && !payload.name) {
        throw ApiError.badRequest('Category name is required.');
    }

    // Regenerated ONLY when the slug was explicitly sent. Renaming a category
    // must not silently re-point its slug: frames and templates are filtered by
    // it, and anything holding the old one stops matching with no error.
    if (payload.slug !== undefined) {
        payload.slug = await buildUniqueSlug(payload.slug || payload.name || category.name, companyId, category.id);
    }

    await baseService.update(TemplateCategory, MODEL_NAME, id, payload, userId, companyId);
    return getById(id, companyId);
};

/**
 * Drag-and-drop ordering, written in ONE transaction.
 *
 * A half-applied reorder leaves two rows claiming the same position and the list
 * then paginates non-deterministically. Ids not owned by this company are
 * skipped rather than rejected, so one stale id in a payload cannot fail the
 * whole reorder.
 */
const reorder = async (items = [], userId = null, companyId = undefined) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw ApiError.badRequest('Provide an array of { id, sort_order }.');
    }

    const ids = items.map((i) => parseInt(i.id, 10)).filter((n) => !Number.isNaN(n));

    const where = { id: ids };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const owned = await TemplateCategory.findAll({ where, attributes: ['id'], raw: true });
    const ownedIds = new Set(owned.map((r) => r.id));

    await sequelize.transaction(async (transaction) => {
        for (const item of items) {
            const id = parseInt(item.id, 10);
            if (!ownedIds.has(id)) continue;
            await TemplateCategory.update(
                { sort_order: parseInt(item.sort_order, 10) || 0, updated_by: userId },
                { where: { id }, transaction }
            );
        }
    });

    return { updated: ownedIds.size };
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    await baseService.update(TemplateCategory, MODEL_NAME, id, { is_active: toBit(is_active, 1) }, userId, companyId);
    return getById(id, companyId);
};

/**
 * Deleting a category does NOT delete the frames filed under it.
 *
 * This is a SOFT delete, so `frame_styles.template_category_id` keeps pointing
 * at the now-deleted row. The frames' `category` include reads through the
 * default scope, so they join as null and show as uncategorised — and restoring
 * the category puts every one of them back automatically. Blanking the column
 * here would make that restore lossy, so it is left alone on purpose.
 *
 * The count is reported back so the caller can say how many rows this affected
 * rather than leaving it to be discovered on the Frame Styles list.
 */
const deleteById = async (id, userId = null, companyId = undefined) => {
    const frames = await FrameStyle.count({ where: { template_category_id: id } });
    await baseService.remove(TemplateCategory, MODEL_NAME, id, userId, companyId);
    return { orphaned_frame_styles: frames };
};

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    reorder,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
