const { Sequelize, User, EventTemplate, EventCategory, EventType, Religion, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const MODEL_NAME = 'EventTemplate';
const MODULE_SLUG = 'event_templates';

/**
 * Invitation templates — the six-step Create Template wizard.
 *
 * The wizard's steps 3 and 4 are two maps of on/off switches keyed by the SAME
 * component vocabulary, and step 3 additionally carries an ORDER. Getting those
 * three structures to survive a round trip is most of what this file does:
 *
 *   components       { event_title: 1, venue: 0, … }   which parts appear
 *   component_order  ['event_title', 'venue', …]       drag-and-drop order
 *   permissions      { background: 1, fonts: 0, … }    what a client may edit
 *
 * Everything here is whitelisted and normalised on write. A JSON column will
 * accept literally anything, so if the shape is not enforced at the boundary it
 * is not enforced at all — and the renderer that eventually reads these has no
 * way to complain about a key it does not know.
 */

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = [
    // step 1
    'name', 'code', 'event_category_id', 'event_type_id', 'religion_id',
    'style', 'tags', 'description',
    // step 2
    'layout_style', 'background_type', 'background_color', 'secondary_color',
    'background_image', 'gradient_from', 'gradient_to', 'custom_css',
    'overlay_opacity', 'orientation', 'dimension', 'primary_font',
    'secondary_font', 'border_style', 'decorations',
    // step 3
    'components', 'component_order',
    // step 4
    'permissions',
    // step 5 — NOTE: no pricing fields. "Template Pricing" was removed from the
    // form, and a writable field with no control behind it is a field that gets
    // set by accident.
    'status', 'is_active', 'is_featured', 'available_for', 'plan_availability',
    'plan_ids', 'sort_order', 'show_on_homepage', 'thumbnail',
];

/**
 * The component vocabulary, in the order the wizard first offers it.
 *
 * This is the single source of truth for BOTH step 3 and step 4 — an unknown
 * key is dropped on write rather than stored, so a renamed component cannot
 * leave orphan keys in JSON that nothing will ever clean up.
 */
const COMPONENT_KEYS = [
    'event_title',
    'host_names',
    'date_time',
    'venue',
    'event_qr_code',
    'organizer',
    'event_photos',
    'contact_details',
    'invitation_message',
    'social_icons',
    'footer_note',
    'decoration_elements',
];

/**
 * Step 4 covers the same components PLUS three whole-design aspects that are
 * not components in their own right (you cannot toggle "Colors" ON in step 3 —
 * every template has colours).
 */
const PERMISSION_KEYS = ['background', 'colors', 'fonts', ...COMPONENT_KEYS];

const STYLES = ['classic', 'floral', 'royal', 'minimal', 'modern', 'traditional'];
const LAYOUT_STYLES = ['classic', 'modern', 'elegant', 'minimal', 'traditional'];
const BACKGROUND_TYPES = ['color', 'image', 'gradient', 'custom'];
const ORIENTATIONS = ['portrait', 'landscape'];
const PLAN_AVAILABILITY = ['all', 'selected', 'trial'];
const AUDIENCES = ['individual', 'company'];
const STATUSES = ['draft', 'published'];

// Only what the list and form render — no SELECT * on the joined tables.
const TEMPLATE_INCLUDE = [
    { model: EventCategory, as: 'category', attributes: ['id', 'name', 'color'], required: false },
    { model: EventType, as: 'eventType', attributes: ['id', 'name', 'color'], required: false },
    { model: Religion, as: 'religion', attributes: ['id', 'name', 'color'], required: false },
];

/** Detail-only joins, so the View page can show Created By / Updated By. */
const AUDIT_INCLUDE = [
    { model: User, as: 'creator', attributes: ['id', 'full_name'], required: false },
    { model: User, as: 'updater', attributes: ['id', 'full_name'], required: false },
];

/* ------------------------------------------------------------- normalisers -- */

const toBit = (value, fallback = 0) => {
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

const slugifyCode = (value) =>
    String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/**
 * A JSON array column. Accepts an array or a comma-separated string (which is
 * what a form field sends when its tag input has not been parsed), trims,
 * de-dupes and drops empties.
 */
const toStringList = (raw, { max = 50, maxLength = 60 } = {}) => {
    if (raw === undefined) return undefined;
    if (raw === null) return [];

    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    const out = [];
    for (const item of list) {
        const v = String(item ?? '').trim().slice(0, maxLength);
        if (v && !out.includes(v)) out.push(v);
        if (out.length >= max) break;
    }
    return out;
};

const toIdList = (raw) => {
    if (raw === undefined) return undefined;
    if (raw === null) return [];

    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    const out = [];
    for (const item of list) {
        const n = parseInt(item, 10);
        if (!Number.isNaN(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
};

/**
 * A map of `key -> 0|1` over a fixed vocabulary.
 *
 * EVERY known key is written, present or not — a half-filled map means the
 * reader has to guess what a missing key meant, and "missing" reads as OFF in
 * one place and ON in another. Unknown keys are dropped.
 */
const toFlagMap = (raw, keys, fallback = 1) => {
    if (raw === undefined) return undefined;

    // A checkbox group posts the checked keys as an array; the form posts a map.
    const source = Array.isArray(raw)
        ? raw.reduce((acc, k) => ({ ...acc, [String(k)]: 1 }), {})
        : (raw && typeof raw === 'object' ? raw : {});

    const explicit = Array.isArray(raw);

    return keys.reduce((acc, key) => {
        // From an array, a key not listed is OFF. From a map, a key not present
        // is the module default — a partial PATCH must not silently blank the
        // components it did not mention.
        acc[key] = key in source ? toBit(source[key], fallback) : (explicit ? 0 : fallback);
        return acc;
    }, {});
};

/**
 * The drag-and-drop order.
 *
 * Unknown keys are dropped and any known key the client omitted is APPENDED, so
 * the stored array is always a complete permutation of the vocabulary. Storing
 * a partial order would mean the renderer has to invent a position for the rest,
 * and it would invent a different one than this screen shows.
 */
const toComponentOrder = (raw) => {
    if (raw === undefined) return undefined;

    const list = Array.isArray(raw) ? raw : [];
    const seen = [];
    for (const item of list) {
        const key = String(item ?? '').trim();
        if (COMPONENT_KEYS.includes(key) && !seen.includes(key)) seen.push(key);
    }
    for (const key of COMPONENT_KEYS) {
        if (!seen.includes(key)) seen.push(key);
    }
    return seen;
};

const clampInt = (raw, min, max, fallback) => {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(Math.max(n, min), max);
};

/**
 * Hex only. A colour input can post anything, and an unvalidated value ends up
 * inline in a style attribute on whatever eventually renders the invitation.
 */
const toHex = (raw) => {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return null;
    const v = String(raw).trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v.toUpperCase() : null;
};

const pickWritable = (data = {}) => {
    const payload = WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

    /* step 1 */
    if (payload.name !== undefined) payload.name = String(payload.name ?? '').trim().slice(0, 200);
    if (payload.description !== undefined) {
        payload.description = String(payload.description ?? '').trim().slice(0, 500) || null;
    }
    if (payload.style !== undefined) payload.style = oneOf(payload.style, STYLES, 'classic');
    if (payload.tags !== undefined) payload.tags = toStringList(payload.tags, { max: 20, maxLength: 40 });
    for (const key of ['event_category_id', 'event_type_id', 'religion_id']) {
        if (payload[key] !== undefined) {
            const n = parseInt(payload[key], 10);
            payload[key] = Number.isNaN(n) ? null : n;
        }
    }

    /* step 2 */
    if (payload.layout_style !== undefined) {
        payload.layout_style = oneOf(payload.layout_style, LAYOUT_STYLES, 'classic');
    }
    if (payload.background_type !== undefined) {
        payload.background_type = oneOf(payload.background_type, BACKGROUND_TYPES, 'color');
    }
    for (const key of ['background_color', 'secondary_color', 'gradient_from', 'gradient_to']) {
        if (payload[key] !== undefined) payload[key] = toHex(payload[key]);
    }
    if (payload.overlay_opacity !== undefined) {
        payload.overlay_opacity = clampInt(payload.overlay_opacity, 0, 100, 0);
    }
    if (payload.orientation !== undefined) {
        payload.orientation = oneOf(payload.orientation, ORIENTATIONS, 'portrait');
    }
    if (payload.decorations !== undefined) payload.decorations = toStringList(payload.decorations, { max: 24 });
    for (const key of ['background_image', 'thumbnail', 'dimension', 'primary_font', 'secondary_font', 'border_style']) {
        if (payload[key] !== undefined) payload[key] = String(payload[key] ?? '').trim() || null;
    }
    if (payload.custom_css !== undefined) payload.custom_css = String(payload.custom_css ?? '').trim() || null;

    /* step 3 */
    if (payload.components !== undefined) payload.components = toFlagMap(payload.components, COMPONENT_KEYS, 1);
    if (payload.component_order !== undefined) payload.component_order = toComponentOrder(payload.component_order);

    /* step 4 */
    if (payload.permissions !== undefined) payload.permissions = toFlagMap(payload.permissions, PERMISSION_KEYS, 1);

    /* step 5 */
    if (payload.status !== undefined) payload.status = oneOf(payload.status, STATUSES, 'draft');
    if (payload.is_active !== undefined) payload.is_active = toBit(payload.is_active, 1);
    if (payload.is_featured !== undefined) payload.is_featured = toBit(payload.is_featured, 0);
    if (payload.show_on_homepage !== undefined) payload.show_on_homepage = toBit(payload.show_on_homepage, 0);
    if (payload.available_for !== undefined) {
        const picked = toStringList(payload.available_for, { max: 4, maxLength: 20 })
            .map((v) => v.toLowerCase())
            // The form's third checkbox is "Both". It is a convenience that ticks
            // the other two, never a stored value of its own — otherwise a reader
            // has to handle three cases where there are only two audiences.
            .flatMap((v) => (v === 'both' ? AUDIENCES : [v]))
            .filter((v) => AUDIENCES.includes(v));
        payload.available_for = [...new Set(picked)];
    }
    if (payload.plan_availability !== undefined) {
        payload.plan_availability = oneOf(payload.plan_availability, PLAN_AVAILABILITY, 'all');
    }
    if (payload.plan_ids !== undefined) payload.plan_ids = toIdList(payload.plan_ids);
    if (payload.sort_order !== undefined) payload.sort_order = clampInt(payload.sort_order, 0, 999999, 0);

    // "Selected Plans" with nothing selected would be available to nobody while
    // the screen says it is restricted. Fall back to All rather than storing a
    // restriction that hides the template from everyone.
    if (payload.plan_availability === 'selected' && Array.isArray(payload.plan_ids) && payload.plan_ids.length === 0) {
        payload.plan_availability = 'all';
    }
    // Plan ids are meaningless unless the mode is "selected"; clearing them
    // stops a later switch back to "selected" resurrecting a stale list.
    if (payload.plan_availability !== undefined && payload.plan_availability !== 'selected') {
        payload.plan_ids = [];
    }

    return payload;
};

/* ---------------------------------------------------------------- defaults -- */

/**
 * A template created without step 3/4 is still a template. These are the
 * wizard's own defaults — everything on, in the catalogue order — so a row
 * created by an API call renders the same as one created by the form.
 */
const defaultComponents = () => COMPONENT_KEYS.reduce((acc, k) => ({ ...acc, [k]: 1 }), {});
const defaultPermissions = () => PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: 1 }), {});

/* ------------------------------------------------------------------ reads -- */

/**
 * JSON columns come back as whatever was written, and rows created before a
 * key existed have `null`. Every read normalises, so the frontend never has to
 * write `template.components?.venue ?? true` — which is exactly the kind of
 * defaulting that ends up different in three files.
 */
const shape = (row) => {
    const plain = row && row.toJSON ? row.toJSON() : { ...row };

    plain.tags = Array.isArray(plain.tags) ? plain.tags : [];
    plain.decorations = Array.isArray(plain.decorations) ? plain.decorations : [];
    plain.plan_ids = Array.isArray(plain.plan_ids) ? plain.plan_ids : [];
    plain.available_for = Array.isArray(plain.available_for) && plain.available_for.length
        ? plain.available_for
        : [...AUDIENCES];

    plain.components = toFlagMap(plain.components ?? {}, COMPONENT_KEYS, 1);
    plain.permissions = toFlagMap(plain.permissions ?? {}, PERMISSION_KEYS, 1);
    plain.component_order = toComponentOrder(plain.component_order ?? []);

    return plain;
};

const numericFilter = (raw) => {
    if (raw === undefined || raw === null || raw === '' || raw === 'all') return undefined;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
};

const getAll = async (query = {}, companyId = undefined) => {
    // Default to sort_order so the list matches idx_event_templates_listing;
    // an explicit sort_by in the query still wins.
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    const where = {};

    const categoryId = numericFilter(query.event_category_id);
    if (categoryId !== undefined) where.event_category_id = categoryId;

    const typeId = numericFilter(query.event_type_id);
    if (typeId !== undefined) where.event_type_id = typeId;

    const religionId = numericFilter(query.religion_id);
    if (religionId !== undefined) where.religion_id = religionId;

    if (query.style && query.style !== 'all') where.style = String(query.style).toLowerCase();

    if (query.is_featured !== undefined && query.is_featured !== '' && query.is_featured !== 'all') {
        where.is_featured = toBit(query.is_featured, 0);
    }

    // `status` on this list means the Active/Inactive badge, which is the
    // column the mockup's Status filter shows. Draft vs published is a separate
    // filter (`publish_status`) so the two can never be confused for each other.
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

    // baseService's own `status` handling would try to match this against a
    // `status` column; the mapping above has already dealt with it.
    const { status, ...restQuery } = listQuery;

    const result = await baseService.getAll(EventTemplate, MODEL_NAME, restQuery, {
        searchFields: ['name', 'code', 'description'],
        sortableFields: ['sort_order', 'name', 'code', 'created_at', 'updated_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: TEMPLATE_INCLUDE,
        where,
    });

    return { ...result, data: result.data.map(shape) };
};

/**
 * The four tiles above the list.
 *
 * Counted with one grouped query rather than four COUNTs — at ~374ms a round
 * trip to production (§103) four is a visible pause on a screen that has not
 * shown a row yet. `featured` is counted separately because it overlaps the
 * other three: a featured template is also active or inactive, so it is not a
 * fourth slice of the same pie.
 */
const getStats = async (companyId = undefined) => {
    const where = {};
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const rows = await EventTemplate.findAll({
        where,
        attributes: [
            'is_active',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('SUM', sequelize.col('is_featured')), 'featured'],
        ],
        group: ['is_active'],
        raw: true,
    });

    const stats = { total: 0, active: 0, inactive: 0, featured: 0 };
    for (const row of rows) {
        const count = Number(row.count) || 0;
        stats.total += count;
        stats.featured += Number(row.featured) || 0;
        if (Number(row.is_active) === 1) stats.active += count;
        else stats.inactive += count;
    }
    return stats;
};

const getById = async (id, companyId = undefined) => {
    const template = await baseService.getById(EventTemplate, MODEL_NAME, id, {
        companyId,
        include: [...TEMPLATE_INCLUDE, ...AUDIT_INCLUDE],
    });
    return shape(template);
};

/* ----------------------------------------------------------------- writes -- */

/**
 * Codes are unique per company. Rows here are soft-deleted, so the check runs
 * against live rows only and appends -2, -3… rather than failing the save —
 * deliberately not a UNIQUE index, or a deleted row would hold its code hostage
 * forever.
 */
const buildUniqueCode = async (base, companyId, excludeId = null) => {
    const root = slugifyCode(base) || 'template';

    const where = { code: { [Op.like]: `${root}%` } };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;
    if (excludeId) where.id = { [Op.ne]: excludeId };

    const taken = new Set(
        (await EventTemplate.findAll({ where, attributes: ['code'], raw: true })).map((r) => r.code)
    );

    if (!taken.has(root)) return root;
    for (let i = 2; i < 1000; i += 1) {
        if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
    }
    return `${root}-${Date.now()}`;
};

/**
 * A template's event type must belong to its event category, or the list shows
 * a row whose Event Type contradicts its Event Category. Same rule the menu
 * catalogue enforces.
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
 * Religion is OPTIONAL here — the form marks it so, and plenty of templates are
 * not religious. But when one IS chosen it has to sit inside the template's own
 * scope, or the list shows a religion the cascade could never have offered.
 */
const assertReligionMatchesScope = async (categoryId, typeId, religionId, companyId) => {
    if (!religionId) return;

    const religion = await Religion.findByPk(religionId, {
        attributes: ['id', 'event_category_id', 'event_type_id', 'company_id'],
    });
    if (!religion) throw ApiError.badRequest('Selected religion does not exist.');

    if (companyId !== undefined && companyId !== null && religion.company_id && religion.company_id !== companyId) {
        throw ApiError.badRequest('Selected religion does not exist.');
    }
    if (categoryId && religion.event_category_id && Number(religion.event_category_id) !== Number(categoryId)) {
        throw ApiError.badRequest('The selected religion does not belong to the selected event category.');
    }
    if (typeId && religion.event_type_id && Number(religion.event_type_id) !== Number(typeId)) {
        throw ApiError.badRequest('The selected religion does not belong to the selected event type.');
    }
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name) throw ApiError.badRequest('Template name is required.');
    if (!payload.event_category_id) throw ApiError.badRequest('Event category is required.');
    if (!payload.event_type_id) throw ApiError.badRequest('Event type is required.');

    await assertTypeMatchesCategory(payload.event_category_id, payload.event_type_id, companyId);
    await assertReligionMatchesScope(
        payload.event_category_id,
        payload.event_type_id,
        payload.religion_id,
        companyId
    );

    payload.code = await buildUniqueCode(payload.code || payload.name, companyId);

    // Defaults applied on create only — see defaultComponents.
    if (payload.components === undefined) payload.components = defaultComponents();
    if (payload.permissions === undefined) payload.permissions = defaultPermissions();
    if (payload.component_order === undefined) payload.component_order = [...COMPONENT_KEYS];

    const template = await baseService.create(EventTemplate, MODEL_NAME, payload, userId, companyId);
    return getById(template.id, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const template = await EventTemplate.findByPk(id);
    if (!template) throw ApiError.notFound('Template not found');
    if (companyId !== undefined && companyId !== null && template.company_id && template.company_id !== companyId) {
        throw ApiError.notFound('Template not found');
    }

    const payload = pickWritable(data);

    if (payload.name !== undefined && !payload.name) {
        throw ApiError.badRequest('Template name is required.');
    }

    const nextCategoryId = payload.event_category_id ?? template.event_category_id;
    const nextTypeId = payload.event_type_id ?? template.event_type_id;

    // Only revalidated when the request actually touches the scope — a PATCH
    // that flips one switch must not be rejected because a pre-existing row
    // predates the rule.
    const touchesScope = payload.event_category_id !== undefined
        || payload.event_type_id !== undefined
        || payload.religion_id !== undefined;

    if (touchesScope) {
        await assertTypeMatchesCategory(nextCategoryId, nextTypeId, companyId);
        await assertReligionMatchesScope(
            nextCategoryId,
            nextTypeId,
            payload.religion_id ?? template.religion_id,
            companyId
        );
    }

    // Regenerate only when the code was explicitly sent. Unlike a menu slug,
    // renaming a template must NOT re-point its code: clients' events reference
    // a template by it, and a silent change orphans them.
    if (payload.code !== undefined) {
        payload.code = await buildUniqueCode(payload.code || payload.name || template.name, companyId, template.id);
    }

    await baseService.update(EventTemplate, MODEL_NAME, id, payload, userId, companyId);
    return getById(id, companyId);
};

/** The list's Change Status action. */
const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    await baseService.update(EventTemplate, MODEL_NAME, id, { is_active: toBit(is_active, 1) }, userId, companyId);
    return getById(id, companyId);
};

/** The list's Set as Featured action. */
const updateFeatured = async (id, is_featured, userId = null, companyId = undefined) => {
    await baseService.update(EventTemplate, MODEL_NAME, id, { is_featured: toBit(is_featured, 0) }, userId, companyId);
    return getById(id, companyId);
};

/**
 * Action-menu "Duplicate" — copies the row, appends (Copy), fresh code.
 *
 * The copy always lands as a DRAFT, whatever the source was. Duplicating a
 * published template and immediately publishing the copy under a near-identical
 * name is not something anyone means to do in one click.
 */
const duplicate = async (id, userId = null, companyId = undefined) => {
    const source = await EventTemplate.findByPk(id);
    if (!source) throw ApiError.notFound('Template not found');
    if (companyId !== undefined && companyId !== null && source.company_id && source.company_id !== companyId) {
        throw ApiError.notFound('Template not found');
    }

    const src = source.toJSON();
    const payload = WRITABLE_FIELDS.reduce((acc, key) => {
        if (src[key] !== undefined) acc[key] = src[key];
        return acc;
    }, {});

    payload.name = `${src.name} (Copy)`;
    payload.code = await buildUniqueCode(payload.name, companyId);
    payload.status = 'draft';
    payload.is_featured = 0;

    const template = await baseService.create(EventTemplate, MODEL_NAME, payload, userId, companyId);
    return getById(template.id, companyId);
};

/**
 * "Change Order". Written in one transaction: a half-applied reorder leaves two
 * rows claiming the same position, and the list then paginates
 * non-deterministically.
 */
const reorder = async (items = [], userId = null, companyId = undefined) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw ApiError.badRequest('Provide an array of { id, sort_order }.');
    }

    const ids = items.map((i) => parseInt(i.id, 10)).filter((n) => !Number.isNaN(n));

    const where = { id: ids };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const owned = await EventTemplate.findAll({ where, attributes: ['id'], raw: true });
    const ownedIds = new Set(owned.map((r) => r.id));

    await sequelize.transaction(async (transaction) => {
        for (const item of items) {
            const id = parseInt(item.id, 10);
            if (!ownedIds.has(id)) continue;
            await EventTemplate.update(
                { sort_order: parseInt(item.sort_order, 10) || 0, updated_by: userId },
                { where: { id }, transaction }
            );
        }
    });

    await logger.logActivity(userId, 'update', MODEL_NAME, `Reordered ${ownedIds.size} templates`, { companyId });
    return { updated: ownedIds.size };
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(EventTemplate, MODEL_NAME, id, userId, companyId);
};

module.exports = {
    getAll,
    getStats,
    getById,
    create,
    update,
    updateStatus,
    updateFeatured,
    duplicate,
    reorder,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
    // Exported so the controller and any future public/read endpoint speak the
    // same vocabulary rather than each hardcoding its own copy.
    COMPONENT_KEYS,
    PERMISSION_KEYS,
};
