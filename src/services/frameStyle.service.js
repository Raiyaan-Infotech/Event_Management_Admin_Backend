const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { Sequelize, User, FrameStyle, TemplateCategory, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const mediaService = require('./media.service');
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

/* ─────────────────────────────── recolouring ─────────────────────────────── */

/**
 * Recolouring an SVG frame style.
 *
 * Same trick as `decoration.service.js`'s recolour, moved here because a frame
 * is the same kind of flat-fill SVG artwork wrapped in a different table: read
 * the text, substitute the hexes, write it back. No rasterising, no image
 * library, nothing to install.
 *
 * ── WHY THE SERVER FETCHES THE FILE ──────────────────────────────────────────
 * The bucket serves no `Access-Control-Allow-Origin`, so the browser cannot
 * fetch its own frame file to read the palette out of it. The server has no
 * such restriction, so `getSvgSource` hands the markup down and the editor
 * recolours a local string for its live preview — one round trip, and the
 * colour picker stays instant instead of a request per nudge.
 *
 * ── ONLY HEX, ONLY SOLID FILLS ───────────────────────────────────────────────
 * `rgba(0,0,0,0.16)` shading strokes are deliberately NOT offered — see the
 * same note in `decoration.service.js`.
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
 * and from nowhere else. A frame lives on a CDN, so refusing every internal
 * address costs nothing real.
 *
 * This checks the literal host only. A public name that RESOLVES to a private
 * address still gets through — closing that needs IP checking inside the
 * connect handshake, which is disproportionate here given every caller is an
 * authenticated admin holding `frame_styles.view`.
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
 *  2. A URL that is already a `file_url` on a frame style row. Needed because
 *     storage settings are per-environment: a database restored from
 *     production carries CDN URLs that the local, unconfigured environment
 *     would otherwise refuse to read, making every existing frame un-editable
 *     there.
 *
 * (2) is still gated on `isInternalHost`, since `file_url` is a free-text
 * column an admin could otherwise point anywhere.
 */
const resolveMediaSource = async (fileUrl, companyId = 1) => {
    const url = String(fileUrl || '').trim();
    if (!url) throw ApiError.badRequest('A frame style file URL is required.');

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

    // Fall back to "is this actually one of our frame styles" — see (2) above.
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw ApiError.badRequest('That file is not a frame style upload.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || isInternalHost(parsed.hostname)) {
        throw ApiError.badRequest('That file is not a frame style upload.');
    }

    const where = { file_url: url };
    if (companyId !== undefined && companyId !== null) {
        where.company_id = { [Op.or]: [companyId, null] };
    }
    const known = await FrameStyle.findOne({ where, attributes: ['id'], paranoid: false });
    if (!known) throw ApiError.badRequest('That file is not a frame style upload.');

    return { kind: 'remote', url };
};

const readSvg = async (fileUrl, companyId = 1) => {
    const source = await resolveMediaSource(fileUrl, companyId);

    let svg;
    if (source.kind === 'local') {
        if (!fs.existsSync(source.full)) throw ApiError.notFound('That frame style file no longer exists.');
        svg = fs.readFileSync(source.full, 'utf8');
    } else {
        const response = await axios.get(source.url, {
            timeout: 15000,
            responseType: 'text',
            // An HTML error page would otherwise be "recoloured" and saved as
            // the frame style, replacing the artwork with a 404 document.
            transformResponse: [(body) => body],
            maxContentLength: 5 * 1024 * 1024,
        });
        svg = String(response.data || '');
    }

    if (!svg.includes('<svg')) {
        throw ApiError.badRequest('Only SVG frame styles can be recoloured.');
    }
    return svg;
};

/**
 * The distinct colours in the file, most-used first.
 *
 * Ordered by how much of the artwork each one paints, so the colour someone
 * means by "the gold one" is the first swatch rather than whichever hex the
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

/** `GET /frame-styles/svg-source` — the markup plus its palette. */
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
        throw ApiError.badRequest('None of those colours appear in this frame style.');
    }

    const baseName = String(options.file_name || 'frame-style')
        .replace(/\.[^.]+$/, '')
        .replace(/-recoloured(-\d+)?$/i, '')
        .slice(0, 100) || 'frame-style';

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
        { folder: 'frame-styles' },
        companyId
    );

    const url = uploaded?.url;
    if (!url) throw ApiError.badRequest('Could not save the recoloured frame style.');

    return {
        url,
        file_name: `${baseName}-recoloured.svg`,
        file_format: 'SVG',
        file_size: buffer.length,
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
    deleteById,
    getSvgSource,
    recolor,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
    // Exported so the controller and any future consumer speak the same
    // vocabulary rather than each hardcoding its own copy.
    LAYOUTS,
    LAYOUT_LABELS,
};
