const { Sequelize, User, Decoration, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'Decoration';
const MODULE_SLUG = 'decorations';

/**
 * Decorations — uploaded ornament images used inside invitation templates.
 *
 * The file is the record. Everything else is how it gets found again and how
 * the list renders without touching storage.
 */

const WRITABLE_FIELDS = [
    'name', 'type', 'file_url', 'file_name', 'file_format', 'file_size',
    'is_active', 'sort_order',
];

/**
 * Where a decoration is placed.
 *
 * A placement, NOT a design family — see the model. Fixed vocabulary because
 * the list renders whatever is stored, so an unknown value would print itself
 * into the Category badge and no screen could have produced it.
 */
const TYPES = ['corner', 'divider', 'ornament', 'top', 'bottom', 'motif'];

const TYPE_LABELS = {
    corner: 'Corner',
    divider: 'Divider',
    ornament: 'Ornament',
    top: 'Top',
    bottom: 'Bottom',
    motif: 'Motif',
};

/** What the uploader accepts. Mirrors the fileFilter in media.routes.js. */
const FORMATS = ['PNG', 'JPG', 'JPEG', 'WEBP', 'SVG'];

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
 * Normalise the Format column to one of FORMATS.
 *
 * Accepts a bare extension or a full mime type, because the browser has the
 * mime and a filename has the extension, and both end up here depending on the
 * caller. Anything unrecognised is stored as null rather than as itself — the
 * column feeds a badge, and a stray "application/octet-stream" in it is worse
 * than a dash.
 */
const toFormat = (raw, fileName = '') => {
    if (raw === undefined && !fileName) return undefined;

    let value = String(raw ?? '').trim();
    if (value.includes('/')) value = value.split('/').pop();     // image/svg+xml -> svg+xml
    if (value.includes('+')) value = value.split('+')[0];        // svg+xml       -> svg
    if (!value && fileName) value = String(fileName).split('.').pop();

    value = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (value === 'JPEG') value = 'JPG';

    return FORMATS.includes(value) || value === 'JPG' ? value : null;
};

const pickWritable = (data = {}) => {
    const payload = WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

    if (payload.name !== undefined) payload.name = String(payload.name ?? '').trim().slice(0, 150);
    if (payload.type !== undefined) payload.type = oneOf(payload.type, TYPES, 'corner');

    for (const key of ['file_url', 'file_name']) {
        if (payload[key] !== undefined) payload[key] = String(payload[key] ?? '').trim() || null;
    }

    if (payload.file_format !== undefined || payload.file_name !== undefined) {
        payload.file_format = toFormat(payload.file_format, payload.file_name || '');
    }

    // 0 is a real answer only for an empty file, which cannot happen — so it is
    // treated as "not reported" and left null rather than shown as "0 KB".
    if (payload.file_size !== undefined) {
        const n = parseInt(payload.file_size, 10);
        payload.file_size = Number.isNaN(n) || n <= 0 ? null : n;
    }

    if (payload.is_active !== undefined) payload.is_active = toBit(payload.is_active, 1);
    if (payload.sort_order !== undefined) payload.sort_order = clampInt(payload.sort_order, 0, 999999, 0);

    return payload;
};

/**
 * Human-readable size for the list's Size column.
 *
 * Built here so every screen prints it identically — the same value formatted
 * three ways in three files is how "245 KB" and "0.24 MB" end up on the same
 * page.
 */
const formatSize = (bytes) => {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const shape = (row) => {
    const plain = row && row.toJSON ? row.toJSON() : { ...row };
    plain.type_label = TYPE_LABELS[plain.type] ?? plain.type;
    plain.file_size_label = formatSize(plain.file_size);
    return plain;
};

const getAll = async (query = {}, companyId = undefined) => {
    // Newest first: this is an upload log, and the row someone just added is the
    // one they are looking for. `sort_by` in the query still wins.
    const listQuery = { sort_by: 'created_at', sort_order: 'DESC', ...query };

    const where = {};

    if (query.type && query.type !== 'all') {
        const t = oneOf(query.type, TYPES, null);
        // An unknown type must match NOTHING rather than being dropped, or the
        // filter silently shows every row and reads as broken.
        where.type = t ?? { [Op.eq]: null };
    }

    if (query.file_format && query.file_format !== 'all') {
        const f = toFormat(query.file_format);
        where.file_format = f ?? { [Op.eq]: null };
    }

    if (query.is_active !== undefined && query.is_active !== '' && query.is_active !== 'all') {
        where.is_active = toBit(query.is_active, 1);
    }

    // baseService's own `status` handling would try to match this against a
    // `status` column, which this table does not have.
    const { status, ...restQuery } = listQuery;

    const result = await baseService.getAll(Decoration, MODEL_NAME, restQuery, {
        searchFields: ['name', 'file_name'],
        sortableFields: ['created_at', 'name', 'type', 'file_size', 'sort_order', 'updated_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        where,
    });

    return { ...result, data: result.data.map(shape) };
};

/** The tiles above the list, counted in ONE grouped query. */
const getStats = async (companyId = undefined) => {
    const where = {};
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const rows = await Decoration.findAll({
        where,
        attributes: [
            'is_active',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('SUM', sequelize.col('file_size')), 'bytes'],
        ],
        group: ['is_active'],
        raw: true,
    });

    const stats = { total: 0, active: 0, inactive: 0, total_bytes: 0 };
    for (const row of rows) {
        const count = Number(row.count) || 0;
        stats.total += count;
        stats.total_bytes += Number(row.bytes) || 0;
        if (Number(row.is_active) === 1) stats.active += count;
        else stats.inactive += count;
    }
    stats.total_size_label = formatSize(stats.total_bytes) ?? '0 KB';
    return stats;
};

const getById = async (id, companyId = undefined) => {
    const decoration = await baseService.getById(Decoration, MODEL_NAME, id, {
        companyId,
        include: AUDIT_INCLUDE,
    });
    return shape(decoration);
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name) throw ApiError.badRequest('Decoration name is required.');
    // A decoration with no image is a name and nothing else — the list's Preview
    // column would be empty and there would be nothing to place on a template.
    if (!payload.file_url) throw ApiError.badRequest('Please upload the decoration image.');

    if (payload.type === undefined) payload.type = 'corner';

    const created = await baseService.create(Decoration, MODEL_NAME, payload, userId, companyId);
    return getById(created.id, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const decoration = await Decoration.findByPk(id);
    if (!decoration) throw ApiError.notFound('Decoration not found');
    if (companyId !== undefined && companyId !== null && decoration.company_id && decoration.company_id !== companyId) {
        throw ApiError.notFound('Decoration not found');
    }

    const payload = pickWritable(data);

    if (payload.name !== undefined && !payload.name) {
        throw ApiError.badRequest('Decoration name is required.');
    }
    // Only rejected when the request actually clears it. A PATCH that renames
    // must not be refused because it did not resend the image.
    if (payload.file_url !== undefined && !payload.file_url) {
        throw ApiError.badRequest('Please upload the decoration image.');
    }

    await baseService.update(Decoration, MODEL_NAME, id, payload, userId, companyId);
    return getById(id, companyId);
};

/** The list's Change Status action. */
const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    await baseService.update(Decoration, MODEL_NAME, id, { is_active: toBit(is_active, 1) }, userId, companyId);
    return getById(id, companyId);
};

/**
 * Drag-and-drop ordering, written in ONE transaction.
 *
 * A half-applied reorder leaves two rows claiming the same position and the list
 * then paginates non-deterministically.
 */
const reorder = async (items = [], userId = null, companyId = undefined) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw ApiError.badRequest('Provide an array of { id, sort_order }.');
    }

    const ids = items.map((i) => parseInt(i.id, 10)).filter((n) => !Number.isNaN(n));

    const where = { id: ids };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const owned = await Decoration.findAll({ where, attributes: ['id'], raw: true });
    const ownedIds = new Set(owned.map((r) => r.id));

    await sequelize.transaction(async (transaction) => {
        for (const item of items) {
            const id = parseInt(item.id, 10);
            if (!ownedIds.has(id)) continue;
            await Decoration.update(
                { sort_order: parseInt(item.sort_order, 10) || 0, updated_by: userId },
                { where: { id }, transaction }
            );
        }
    });

    return { updated: ownedIds.size };
};

const deleteById = async (id, userId = null, companyId = undefined) =>
    baseService.remove(Decoration, MODEL_NAME, id, userId, companyId);

module.exports = {
    getAll,
    getStats,
    getById,
    create,
    update,
    updateStatus,
    reorder,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
    // Exported so every consumer speaks the same vocabulary rather than each
    // hardcoding its own copy.
    TYPES,
    TYPE_LABELS,
    FORMATS,
};
