const { Sequelize, User, FrameStyle, TemplateCategory, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'FrameStyle';
const MODULE_SLUG = 'frame_styles';

/**
 * Frame / border styles — the uploaded artwork that frames an invitation.
 *
 * The file is the design. This file's job is to make sure the row around it is
 * trustworthy: a category that exists, a layout list that is a real subset, and
 * the draft/active pair kept apart.
 */

const WRITABLE_FIELDS = [
    'name', 'template_category_id', 'file_url', 'file_name',
    'supported_layouts', 'status', 'is_active', 'sort_order',
];

/**
 * The page shapes a frame can be drawn for.
 *
 * Fixed vocabulary: the list renders whatever is stored, so an unknown value
 * would print itself into the Supported Layouts column and no screen could
 * ever have produced it.
 */
const LAYOUTS = ['portrait', 'landscape', 'square'];
const STATUSES = ['draft', 'published'];

const LAYOUT_LABELS = {
    portrait: 'Portrait',
    landscape: 'Landscape',
    square: 'Square',
};

const CATEGORY_INCLUDE = [
    { model: TemplateCategory, as: 'category', attributes: ['id', 'name', 'slug'], required: false },
];

/** Detail-only joins, so the View screen can show Created By / Updated By. */
const AUDIT_INCLUDE = [
    { model: User, as: 'creator', attributes: ['id', 'full_name'], required: false },
    { model: User, as: 'updater', attributes: ['id', 'full_name'], required: false },
];

const toBit = (value, fallback = 1) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number') return value ? 1 : 0;
    const s = String(value).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' ? 1 : 0;
};

const oneOf = (value, allowed, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const s = String(value).toLowerCase().trim();
    return allowed.includes(s) ? s : fallback;
};

const clampInt = (raw, min, max, fallback) => {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(Math.max(n, min), max);
};

/**
 * Normalise the layout list to a real subset of LAYOUTS, in a fixed order.
 *
 * Accepts an array or a comma-separated string, since a checkbox group and a
 * query string send different shapes. Unknown values are dropped rather than
 * stored — a JSON column takes anything, so if it is not enforced here it is
 * not enforced at all.
 *
 * An empty selection falls back to ALL THREE rather than none. A frame that
 * supports no layout is a frame that can never be used, and the form's own
 * wording ("Supported Layouts") reads as a narrowing, not as a switch to turn
 * the row off with.
 */
const toLayouts = (raw) => {
    if (raw === undefined) return undefined;

    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    const picked = new Set();
    for (const item of list) {
        const v = String(item ?? '').trim().toLowerCase();
        if (LAYOUTS.includes(v)) picked.add(v);
    }
    // Ordered by LAYOUTS, not by what arrived, so the list column reads the same
    // whichever order the boxes were ticked in.
    const out = LAYOUTS.filter((l) => picked.has(l));
    return out.length ? out : [...LAYOUTS];
};

const pickWritable = (data = {}) => {
    const payload = WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

    if (payload.name !== undefined) payload.name = String(payload.name ?? '').trim().slice(0, 150);

    if (payload.template_category_id !== undefined) {
        const n = parseInt(payload.template_category_id, 10);
        payload.template_category_id = Number.isNaN(n) ? null : n;
    }

    for (const key of ['file_url', 'file_name']) {
        if (payload[key] !== undefined) payload[key] = String(payload[key] ?? '').trim() || null;
    }

    if (payload.supported_layouts !== undefined) {
        payload.supported_layouts = toLayouts(payload.supported_layouts);
    }

    if (payload.status !== undefined) payload.status = oneOf(payload.status, STATUSES, 'published');
    if (payload.is_active !== undefined) payload.is_active = toBit(payload.is_active, 1);
    if (payload.sort_order !== undefined) payload.sort_order = clampInt(payload.sort_order, 0, 999999, 0);

    return payload;
};

/**
 * The category has to exist and belong to this company.
 *
 * Without this the list renders a blank badge for a row that names a category
 * nobody can see — and the Category filter would never match it either, so the
 * row becomes unreachable through the UI it was created in.
 */
const assertCategory = async (categoryId, companyId) => {
    if (!categoryId) return;

    const category = await TemplateCategory.findByPk(categoryId, {
        attributes: ['id', 'company_id'],
    });
    if (!category) throw ApiError.badRequest('Selected category does not exist.');

    if (companyId !== undefined && companyId !== null && category.company_id && category.company_id !== companyId) {
        throw ApiError.badRequest('Selected category does not exist.');
    }
};

/**
 * JSON comes back as whatever was written, and a row created before a rule
 * existed can hold null. Normalised on read so no screen has to write
 * `frame.supported_layouts ?? ['portrait']` — the kind of defaulting that ends
 * up different in three files.
 */
const shape = (row) => {
    const plain = row && row.toJSON ? row.toJSON() : { ...row };
    plain.supported_layouts = toLayouts(plain.supported_layouts ?? []) ?? [...LAYOUTS];
    plain.supported_layouts_label = plain.supported_layouts
        .map((l) => LAYOUT_LABELS[l])
        .join(', ');
    return plain;
};

const numericFilter = (raw) => {
    if (raw === undefined || raw === null || raw === '' || raw === 'all') return undefined;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
};

const getAll = async (query = {}, companyId = undefined) => {
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    const where = {};

    const categoryId = numericFilter(query.template_category_id);
    if (categoryId !== undefined) where.template_category_id = categoryId;

    // The list's Status filter shows the Active/Inactive badge. Draft vs
    // published is a separate filter, so the two can never be read as one.
    if (query.status && query.status !== 'all') {
        const s = String(query.status).toLowerCase();
        if (s === 'active') where.is_active = 1;
        else if (s === 'inactive') where.is_active = 0;
        else if (s === 'draft') where.status = 'draft';
        else if (s === 'published') where.status = 'published';
    }
    if (query.publish_status && query.publish_status !== 'all') {
        where.status = oneOf(query.publish_status, STATUSES, 'draft');
    }

    if (query.layout && query.layout !== 'all' && LAYOUTS.includes(String(query.layout).toLowerCase())) {
        // JSON_CONTAINS rather than a LIKE: a LIKE on '%square%' would also
        // match a value that merely contains the word.
        where[Op.and] = [
            sequelize.literal(
                `JSON_CONTAINS(\`FrameStyle\`.\`supported_layouts\`, '"${String(query.layout).toLowerCase()}"')`
            ),
        ];
    }

    const { status, ...restQuery } = listQuery;

    const result = await baseService.getAll(FrameStyle, MODEL_NAME, restQuery, {
        searchFields: ['name'],
        sortableFields: ['sort_order', 'name', 'created_at', 'updated_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: CATEGORY_INCLUDE,
        where,
    });

    return { ...result, data: result.data.map(shape) };
};

/**
 * The tiles above the list, counted in ONE grouped query.
 *
 * Four separate COUNTs is a visible pause at ~374ms per production round trip,
 * on a screen that has not shown a row yet.
 */
const getStats = async (companyId = undefined) => {
    const where = {};
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const rows = await FrameStyle.findAll({
        where,
        attributes: [
            'is_active',
            'status',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        ],
        group: ['is_active', 'status'],
        raw: true,
    });

    const stats = { total: 0, active: 0, inactive: 0, draft: 0 };
    for (const row of rows) {
        const count = Number(row.count) || 0;
        stats.total += count;
        if (Number(row.is_active) === 1) stats.active += count;
        else stats.inactive += count;
        // Draft overlaps active/inactive — a draft is also one or the other, so
        // it is a separate fact rather than a fourth slice of the same pie.
        if (row.status === 'draft') stats.draft += count;
    }
    return stats;
};

const getById = async (id, companyId = undefined) => {
    const frame = await baseService.getById(FrameStyle, MODEL_NAME, id, {
        companyId,
        include: [...CATEGORY_INCLUDE, ...AUDIT_INCLUDE],
    });
    return shape(frame);
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name) throw ApiError.badRequest('Frame style name is required.');
    if (!payload.template_category_id) throw ApiError.badRequest('Category is required.');

    // A frame style with no artwork is a name and nothing else — the list's
    // Preview column would be empty and there would be nothing to apply.
    // Enforced on DRAFTS too: "Save as Draft" means not published yet, not
    // "saved without the thing it exists to hold".
    if (!payload.file_url) throw ApiError.badRequest('Please upload the frame / border file.');

    await assertCategory(payload.template_category_id, companyId);

    if (payload.supported_layouts === undefined) payload.supported_layouts = [...LAYOUTS];
    if (payload.status === undefined) payload.status = 'published';

    const created = await baseService.create(FrameStyle, MODEL_NAME, payload, userId, companyId);
    return getById(created.id, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const frame = await FrameStyle.findByPk(id);
    if (!frame) throw ApiError.notFound('Frame style not found');
    if (companyId !== undefined && companyId !== null && frame.company_id && frame.company_id !== companyId) {
        throw ApiError.notFound('Frame style not found');
    }

    const payload = pickWritable(data);

    if (payload.name !== undefined && !payload.name) {
        throw ApiError.badRequest('Frame style name is required.');
    }
    if (payload.template_category_id !== undefined && !payload.template_category_id) {
        throw ApiError.badRequest('Category is required.');
    }
    // Only rejected when the request actually clears it. A PATCH that flips one
    // switch must not be refused because it did not resend the file.
    if (payload.file_url !== undefined && !payload.file_url) {
        throw ApiError.badRequest('Please upload the frame / border file.');
    }

    if (payload.template_category_id !== undefined) {
        await assertCategory(payload.template_category_id, companyId);
    }

    await baseService.update(FrameStyle, MODEL_NAME, id, payload, userId, companyId);
    return getById(id, companyId);
};

/** The list's Change Status action. */
const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    await baseService.update(FrameStyle, MODEL_NAME, id, { is_active: toBit(is_active, 1) }, userId, companyId);
    return getById(id, companyId);
};

const deleteById = async (id, userId = null, companyId = undefined) =>
    baseService.remove(FrameStyle, MODEL_NAME, id, userId, companyId);

module.exports = {
    getAll,
    getStats,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
    // Exported so the controller and any future consumer speak the same
    // vocabulary rather than each hardcoding its own copy.
    LAYOUTS,
    LAYOUT_LABELS,
};
