const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { Sequelize, User, Decoration, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const mediaService = require('./media.service');
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

/* ─────────────────────────────── recolouring ─────────────────────────────── */

/**
 * Recolouring an SVG decoration.
 *
 * The seeded decorations are flat SVGs built from a handful of solid fills —
 * "Pink Floral Corner" is five hex values — so swapping those values IS the
 * recolour. No rasterising, no image library, nothing to install: read the
 * text, substitute the hexes, write it back.
 *
 * ── WHY THE SERVER FETCHES THE FILE ──────────────────────────────────────────
 * The bucket serves no `Access-Control-Allow-Origin`, so the browser cannot
 * fetch its own decoration to read the palette out of it. The server has no
 * such restriction, so `getSvgSource` hands the markup down and the editor
 * recolours a local string for its live preview — one round trip, and the
 * colour picker stays instant instead of a request per nudge.
 *
 * ── ONLY HEX, ONLY SOLID FILLS ───────────────────────────────────────────────
 * `rgba(0,0,0,0.16)` shading strokes are deliberately NOT offered. They are
 * shadow, not colour: recolouring them turns a shaded petal into a flat sticker,
 * and they are the same value in every decoration so they would crowd the
 * palette with an entry nobody wants to change.
 */

/** `fill="#abc"` / `stroke='#AABBCC'` / `style="fill:#abc"` — hex only, see above. */
const HEX_TOKEN = /#[0-9a-fA-F]{3,8}\b/g;

/**
 * `#abc` → `#AABBCC`, so the same colour written two ways is ONE swatch.
 *
 * Alpha-carrying forms (`#RRGGBBAA`) keep their alpha and are treated as their
 * own swatch: dropping it here would make an 80%-opaque petal and a solid one
 * indistinguishable in the picker, and re-saving would flatten one into the other.
 */
const normaliseHex = (raw) => {
    const value = String(raw || '').trim();
    const body = value.startsWith('#') ? value.slice(1) : value;

    // The digit test is what makes this a VALIDATOR and not just a formatter:
    // without it a CSS colour name is silently accepted on length alone —
    // "red" is three characters, so it doubles into "#RREEDD" and gets written
    // into the artwork as a colour that does not exist.
    if (!/^[0-9a-fA-F]+$/.test(body)) return null;

    if (body.length === 3 || body.length === 4) {
        return `#${body.split('').map((ch) => ch + ch).join('').toUpperCase()}`;
    }
    if (body.length === 6 || body.length === 8) return `#${body.toUpperCase()}`;
    return null;
};

const isHex = (raw) => normaliseHex(raw) !== null;

/**
 * Hosts the server must never be talked into fetching.
 *
 * Cloud metadata (169.254.169.254) and anything on the private network are the
 * targets that make an SSRF worth having: they are reachable from the server
 * and from nowhere else. A decoration lives on a CDN, so refusing every
 * internal address costs nothing real.
 *
 * This checks the literal host only. A public name that RESOLVES to a private
 * address still gets through — closing that needs IP checking inside the
 * connect handshake, which is disproportionate here given every caller is an
 * authenticated admin holding `decorations.view`.
 */
const isInternalHost = (hostname) => {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');

    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
    if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd')) return true;

    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!v4) return false;

    const [a, b] = v4.slice(1).map(Number);
    return (
        a === 0 || a === 127 || a === 10
        || (a === 169 && b === 254)          // link-local — the metadata endpoint
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
    );
};

/**
 * Refuses to fetch anything that is not one of OUR uploads.
 *
 * Without this the endpoint is an SSRF: it takes a URL from the client and the
 * server fetches it, reaching addresses the browser never could.
 *
 * Two things are accepted, because one alone is not enough:
 *
 *  1. Anything under the CONFIGURED storage base. This is the normal path —
 *     a file just uploaded through `media.service` always matches it.
 *  2. A URL that is already a `file_url` on a decoration row. Needed because
 *     storage settings are per-environment: a database restored from
 *     production carries CDN URLs that the local, unconfigured environment
 *     would otherwise refuse to read, making every existing decoration
 *     un-editable there.
 *
 * (2) is still gated on `isInternalHost`, since `file_url` is a free-text
 * column an admin could otherwise point anywhere.
 */
const resolveMediaSource = async (fileUrl, companyId = 1) => {
    const url = String(fileUrl || '').trim();
    if (!url) throw ApiError.badRequest('A decoration file URL is required.');

    const config = await mediaService.getMediaSettings(companyId);
    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');

    // Local driver: read off disk. Going back out over HTTP to our own process
    // would deadlock a single-worker dev server serving this very request.
    const localPrefixes = ['/uploads/', `${appUrl}/uploads/`].filter(Boolean);
    for (const prefix of localPrefixes) {
        if (prefix && url.startsWith(prefix)) {
            const relative = url.slice(prefix.length);
            // `..` in the path would climb out of the uploads directory.
            const full = path.resolve(__dirname, '../../uploads', relative);
            const root = path.resolve(__dirname, '../../uploads');
            if (!full.startsWith(root + path.sep)) {
                throw ApiError.badRequest('That file path is not allowed.');
            }
            return { kind: 'local', full };
        }
    }

    const remoteBases = [
        config.aws_url,
        config.aws_bucket
            ? `https://${config.aws_bucket}.s3.${config.aws_region || 'us-east-1'}.amazonaws.com`
            : null,
    ]
        .filter(Boolean)
        .map((base) => String(base).replace(/\/+$/, ''));

    if (remoteBases.some((base) => url.startsWith(`${base}/`))) {
        return { kind: 'remote', url };
    }

    // Fall back to "is this actually one of our decorations" — see (2) above.
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw ApiError.badRequest('That file is not a decoration upload.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || isInternalHost(parsed.hostname)) {
        throw ApiError.badRequest('That file is not a decoration upload.');
    }

    const where = { file_url: url };
    if (companyId !== undefined && companyId !== null) {
        where.company_id = { [Op.or]: [companyId, null] };
    }
    const known = await Decoration.findOne({ where, attributes: ['id'], paranoid: false });
    if (!known) throw ApiError.badRequest('That file is not a decoration upload.');

    return { kind: 'remote', url };
};

const readSvg = async (fileUrl, companyId = 1) => {
    const source = await resolveMediaSource(fileUrl, companyId);

    let svg;
    if (source.kind === 'local') {
        if (!fs.existsSync(source.full)) throw ApiError.notFound('That decoration file no longer exists.');
        svg = fs.readFileSync(source.full, 'utf8');
    } else {
        const response = await axios.get(source.url, {
            timeout: 15000,
            responseType: 'text',
            // An HTML error page would otherwise be "recoloured" and saved as
            // the decoration, replacing the artwork with a 404 document.
            transformResponse: [(body) => body],
            maxContentLength: 5 * 1024 * 1024,
        });
        svg = String(response.data || '');
    }

    if (!svg.includes('<svg')) {
        throw ApiError.badRequest('Only SVG decorations can be recoloured.');
    }
    return svg;
};

/**
 * The distinct colours in the file, most-used first.
 *
 * Ordered by how much of the artwork each one paints, so the colour someone
 * means by "the pink one" is the first swatch rather than whichever hex the
 * illustrator happened to write first.
 */
const extractPalette = (svg) => {
    const counts = new Map();
    for (const token of String(svg).match(HEX_TOKEN) ?? []) {
        const hex = normaliseHex(token);
        if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([color, count]) => ({ color, count }));
};

/**
 * The wire format for a recolour: `[{ from: '#4A7A42', to: '#47E22C' }]`.
 *
 * ⚠ A LIST of pairs, never an object keyed by hex. `bodyTransform` rewrites
 * every request-body KEY from camelCase to snake_case, and it cannot tell a
 * colour from a field name — `#4A7A42` arrives as `#4_a7_a42` and every swap
 * is rejected as malformed. Values are left alone, so the colours ride safely
 * as values under the fixed `from` / `to` keys.
 *
 * The object form is still accepted for anything calling this directly in
 * process (a seeder, a test), where no middleware has touched it.
 */
const toColorPairs = (colorMap) => {
    if (Array.isArray(colorMap)) {
        return colorMap
            .filter((pair) => pair && typeof pair === 'object')
            .map((pair) => [pair.from, pair.to]);
    }
    if (colorMap && typeof colorMap === 'object') return Object.entries(colorMap);
    return [];
};

/**
 * Applies the swap in ONE pass.
 *
 * Chained `.replace()` calls would re-read their own output: mapping red→blue
 * and blue→green in sequence turns every originally-red shape green. Rewriting
 * each token exactly once from the ORIGINAL map is the only correct order.
 */
const applyColorMap = (svg, pairs) => {
    const lookup = new Map();
    for (const [from, to] of pairs) {
        const source = normaliseHex(from);
        const target = normaliseHex(to);
        if (source && target) lookup.set(source, target);
    }
    if (lookup.size === 0) return { svg, changed: 0 };

    let changed = 0;
    const next = String(svg).replace(HEX_TOKEN, (token) => {
        const hex = normaliseHex(token);
        const target = hex ? lookup.get(hex) : null;
        if (!target) return token;
        changed += 1;
        return target;
    });

    return { svg: next, changed };
};

/** `GET /decorations/svg-source` — the markup plus its palette. */
const getSvgSource = async (fileUrl, companyId = 1) => {
    const svg = await readSvg(fileUrl, companyId);
    return { svg, colors: extractPalette(svg) };
};

/**
 * Writes the recoloured copy and returns the new file, WITHOUT touching the row.
 *
 * Saving is left to the normal update call so a recolour follows the same
 * approval path as any other edit to the record, instead of a second write
 * route that quietly bypasses it.
 */
const recolor = async (fileUrl, colorMap = [], options = {}, companyId = 1) => {
    const pairs = toColorPairs(colorMap);
    if (pairs.length === 0) throw ApiError.badRequest('Pick at least one colour to change.');
    // A bad hex here would be written into the artwork as literal text and the
    // shape would fall back to black with nothing saying why.
    for (const [from, to] of pairs) {
        if (!isHex(from) || !isHex(to)) {
            throw ApiError.badRequest(`"${from}" → "${to}" is not a pair of hex colours.`);
        }
    }

    const original = await readSvg(fileUrl, companyId);
    const { svg, changed } = applyColorMap(original, pairs);

    if (changed === 0) {
        throw ApiError.badRequest('None of those colours appear in this decoration.');
    }

    const baseName = String(options.file_name || 'decoration')
        .replace(/\.[^.]+$/, '')
        .replace(/-recoloured(-\d+)?$/i, '')
        .slice(0, 100) || 'decoration';

    /**
     * Uploaded as a file object rather than through `uploadDataUri`, which
     * derives the extension from the mime type — `image/svg+xml` becomes a
     * file named `.svg+xml`, which no CDN serves as an image. Naming it here
     * is the only way to get a plain `.svg` on the end.
     */
    const buffer = Buffer.from(svg, 'utf8');
    const uploaded = await mediaService.upload(
        {
            buffer,
            mimetype: 'image/svg+xml',
            size: buffer.length,
            originalname: `${baseName}-recoloured.svg`,
        },
        { folder: 'decorations' },
        companyId
    );

    const url = uploaded?.url;
    if (!url) throw ApiError.badRequest('Could not save the recoloured decoration.');

    const size = buffer.length;
    return {
        url,
        file_name: `${baseName}-recoloured.svg`,
        file_format: 'SVG',
        file_size: size,
        file_size_label: formatSize(size),
        replaced: changed,
        colors: extractPalette(svg),
    };
};

module.exports = {
    getAll,
    getStats,
    getById,
    create,
    update,
    updateStatus,
    reorder,
    deleteById,
    getSvgSource,
    recolor,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
    // Exported so every consumer speaks the same vocabulary rather than each
    // hardcoding its own copy.
    TYPES,
    TYPE_LABELS,
    FORMATS,
};
