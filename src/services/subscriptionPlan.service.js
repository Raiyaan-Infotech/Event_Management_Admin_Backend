const {
    Sequelize,
    User,
    SubscriptionPlan,
    SubscriptionPlanMenu,
    PlanType,
    EventCategory,
    EventType,
    Religion,
    EventMenu,
    sequelize,
} = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const MODEL_NAME = 'SubscriptionPlan';
const MODULE_SLUG = 'subscription_plans';

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = [
    'name', 'plan_code', 'plan_type_id', 'billing_cycle', 'short_description',
    'for_website', 'for_mobile',
    'event_category_id', 'event_type_id', 'religion_id',
    'currency_code', 'price', 'trial_days',
    'is_visible', 'is_active', 'sort_order',
];

/**
 * Wizard step 4 — which limit fields each menu exposes.
 *
 * Keyed by the menu's slug so it survives menus being renamed. A menu with no
 * entry simply gets no limit fields, which is why the fallback is an empty
 * array rather than an error. Same shape as FIELD_CATALOG in the translations
 * service: adding a limit to a menu is a change here, not a schema change.
 *
 * `type: 'select'` fields carry their own options; everything else is a number
 * input where blank means unlimited.
 */
const LIMIT_CATALOG = {
    'event-information': [
        { key: 'max_events', label: 'Max Events' },
        { key: 'max_guests_per_event', label: 'Max Guests Per Event' },
        { key: 'max_rsvps', label: 'Max RSVPs' },
    ],
    gallery: [
        { key: 'max_photos', label: 'Max Photos' },
        { key: 'max_videos', label: 'Max Videos' },
        { key: 'storage_gb', label: 'Storage Space', type: 'select', options: ['1 GB', '10 GB', '50 GB', '100 GB', '500 GB', 'Unlimited'] },
    ],
    'guests-family': [
        { key: 'max_family_members', label: 'Max Family Members' },
        { key: 'max_participants', label: 'Max Participants / Guests' },
    ],
    rsvp: [
        { key: 'max_rsvps', label: 'Max RSVPs' },
        { key: 'rsvp_closing_days', label: 'RSVP Closing Days Before Event', helper: '0 for no limit' },
    ],
    wishes: [{ key: 'max_wishes', label: 'Max Wishes' }],
    'social-wall': [{ key: 'max_posts', label: 'Max Posts' }],
    downloads: [
        { key: 'storage_gb', label: 'Storage Space', type: 'select', options: ['1 GB', '10 GB', '50 GB', '100 GB', '500 GB', 'Unlimited'] },
        { key: 'max_files', label: 'Max Files' },
    ],
    'contact-us': [{ key: 'max_entries', label: 'Max Entries' }],
    agenda: [{ key: 'max_items', label: 'Max Items' }],
    venue: [{ key: 'max_venues', label: 'Max Venues' }],
};

const limitsForMenu = (slug) => LIMIT_CATALOG[slug] || [];

/**
 * Reason options for the Deactivate / Delete confirm screens. In code rather
 * than a table for the same reason as LIMIT_CATALOG — they are a fixed list the
 * UI renders, not data an admin curates.
 */
const REASONS = {
    deactivation: [
        'No longer offered',
        'Replaced by another plan',
        'Pricing under review',
        'Low subscriber count',
        'Temporarily unavailable',
        'Other',
    ],
    deletion: [
        'Plan is not required',
        'Created by mistake',
        'Duplicate plan',
        'Replaced by another plan',
        'Other',
    ],
};

const getReasons = () => REASONS;

/** The catalogue, so the wizard can render step 4 without hardcoding it. */
const getLimitCatalog = () => LIMIT_CATALOG;

const PLAN_INCLUDE = [
    { model: PlanType, as: 'planType', attributes: ['id', 'name'], required: false },
    { model: EventCategory, as: 'category', attributes: ['id', 'name', 'color'], required: false },
    { model: EventType, as: 'eventType', attributes: ['id', 'name', 'color'], required: false },
    { model: Religion, as: 'religion', attributes: ['id', 'name', 'color'], required: false },
];

const MENU_INCLUDE = {
    model: SubscriptionPlanMenu,
    as: 'planMenus',
    required: false,
    include: [
        { model: EventMenu, as: 'menu', attributes: ['id', 'name', 'slug', 'menu_group', 'icon', 'color'], required: false },
    ],
};

const toBit = (v, fallback = 0) => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v ? 1 : 0;
    const s = String(v).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' ? 1 : 0;
};

const numericFilter = (raw) => {
    if (raw === undefined || raw === null || raw === '' || raw === 'all') return undefined;
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? undefined : n;
};

const normaliseCode = (value) =>
    String(value || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_-]/g, '');

const pickWritable = (data = {}) =>
    WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

/**
 * The list badge: a zero-priced plan with a trial reads as "Trial", matching
 * the mockup's Free Trial Plan row. Derived rather than stored so it can never
 * contradict the price.
 */
const decorate = (row) => {
    const plain = row && row.toJSON ? row.toJSON() : { ...row };
    const price = Number(plain.price || 0);
    plain.is_trial = price === 0 && Number(plain.trial_days || 0) > 0;
    plain.total_menus = Array.isArray(plain.planMenus) ? plain.planMenus.length : (plain.total_menus ?? 0);
    plain.menu_for = [
        ...(plain.for_website ? ['website'] : []),
        ...(plain.for_mobile ? ['mobile'] : []),
    ];
    return plain;
};

/** Plan codes are unique per company; soft-deleted rows are ignored. */
const assertCodeAvailable = async (code, companyId, excludeId = null) => {
    const where = { plan_code: code };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;
    if (excludeId) where.id = { [Op.ne]: excludeId };

    const clash = await SubscriptionPlan.findOne({ where, attributes: ['id'] });
    if (clash) throw ApiError.badRequest(`Plan code "${code}" is already in use.`);
};

/**
 * Rewrite a plan's menu rows to exactly what was submitted.
 *
 * Runs in a transaction and deletes only the menus that are no longer selected,
 * rather than clearing the table and re-inserting: re-inserting would churn ids
 * on every save, and anything referencing a plan menu row would be orphaned —
 * the same id-reassignment trap that bit the website builder bulk saves.
 */
const syncPlanMenus = async (planId, menus, transaction) => {
    if (!Array.isArray(menus)) return;

    const incoming = menus
        .map((m, index) => ({
            menu_id: parseInt(m.menu_id ?? m.id, 10),
            for_website: toBit(m.for_website, 0),
            for_mobile: toBit(m.for_mobile, 0),
            limits_json: m.limits_json ?? m.limits ?? null,
            sort_order: m.sort_order ?? index,
        }))
        .filter((m) => !Number.isNaN(m.menu_id));

    const keepIds = incoming.map((m) => m.menu_id);

    await SubscriptionPlanMenu.destroy({
        where: keepIds.length > 0
            ? { plan_id: planId, menu_id: { [Op.notIn]: keepIds } }
            : { plan_id: planId },
        transaction,
    });

    for (const row of incoming) {
        const existing = await SubscriptionPlanMenu.findOne({
            where: { plan_id: planId, menu_id: row.menu_id },
            transaction,
        });
        if (existing) {
            await existing.update(row, { transaction });
        } else {
            await SubscriptionPlanMenu.create({ ...row, plan_id: planId }, { transaction });
        }
    }
};

const getAll = async (query = {}, companyId = undefined) => {
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    const where = {};
    const categoryId = numericFilter(query.event_category_id);
    if (categoryId !== undefined) where.event_category_id = categoryId;

    const typeId = numericFilter(query.event_type_id);
    if (typeId !== undefined) where.event_type_id = typeId;

    const religionId = numericFilter(query.religion_id);
    if (religionId !== undefined) where.religion_id = religionId;

    const planTypeId = numericFilter(query.plan_type_id);
    if (planTypeId !== undefined) where.plan_type_id = planTypeId;

    if (query.billing_cycle && query.billing_cycle !== 'all') {
        where.billing_cycle = String(query.billing_cycle).toLowerCase();
    }

    if (query.is_active !== undefined && query.is_active !== '' && query.is_active !== 'all') {
        where.is_active = toBit(query.is_active, 1);
    }

    const result = await baseService.getAll(SubscriptionPlan, MODEL_NAME, listQuery, {
        searchFields: ['name', 'plan_code', 'short_description'],
        sortableFields: ['sort_order', 'name', 'price', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: [...PLAN_INCLUDE, MENU_INCLUDE],
        where,
    });

    return { ...result, data: result.data.map(decorate) };
};

/** Detail-only joins: the list has no use for them. */
const AUDIT_INCLUDE = [
    { model: User, as: 'creator', attributes: ['id', 'full_name'], required: false },
    { model: User, as: 'updater', attributes: ['id', 'full_name'], required: false },
    { model: User, as: 'deactivator', attributes: ['id', 'full_name'], required: false },
    { model: User, as: 'deleter', attributes: ['id', 'full_name'], required: false },
];

const getById = async (id, companyId = undefined) => {
    const plan = await baseService.getById(SubscriptionPlan, MODEL_NAME, id, {
        companyId,
        include: [...PLAN_INCLUDE, MENU_INCLUDE, ...AUDIT_INCLUDE],
    });
    return decorate(plan);
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Plan name is required');
    }
    payload.name = String(payload.name).trim();

    payload.plan_code = normaliseCode(payload.plan_code);
    if (!payload.plan_code) throw ApiError.badRequest('Plan code is required');
    await assertCodeAvailable(payload.plan_code, companyId);

    if (!payload.for_website && !payload.for_mobile) {
        throw ApiError.badRequest('Select at least one platform for this plan (Website or Mobile App).');
    }

    const plan = await sequelize.transaction(async (transaction) => {
        if (companyId !== undefined && companyId !== null) payload.company_id = companyId;
        if (userId) payload.created_by = userId;

        const created = await SubscriptionPlan.create(payload, { transaction });
        await syncPlanMenus(created.id, data.menus, transaction);
        return created;
    });

    logger.logDB('create', MODEL_NAME, plan.id);
    await logger.logActivity(userId, 'create', MODEL_NAME, `Created subscription plan: ${plan.name}`, {
        recordId: plan.id,
        companyId,
    });

    return getById(plan.id, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const plan = await SubscriptionPlan.findByPk(id);
    if (!plan) throw ApiError.notFound('Subscription plan not found');
    if (companyId !== undefined && companyId !== null && plan.company_id && plan.company_id !== companyId) {
        throw ApiError.notFound('Subscription plan not found');
    }

    const payload = pickWritable(data);

    if (payload.name !== undefined) {
        if (!String(payload.name).trim()) throw ApiError.badRequest('Plan name is required');
        payload.name = String(payload.name).trim();
    }

    if (payload.plan_code !== undefined) {
        payload.plan_code = normaliseCode(payload.plan_code);
        if (!payload.plan_code) throw ApiError.badRequest('Plan code is required');
        await assertCodeAvailable(payload.plan_code, companyId, plan.id);
    }

    // Only checked when the request touches platform targeting, so a PATCH that
    // flips status is not rejected for not resending it.
    if (payload.for_website !== undefined || payload.for_mobile !== undefined) {
        const website = payload.for_website ?? plan.for_website;
        const mobile = payload.for_mobile ?? plan.for_mobile;
        if (!website && !mobile) {
            throw ApiError.badRequest('Select at least one platform for this plan (Website or Mobile App).');
        }
    }

    const oldValues = plan.toJSON();
    if (userId) payload.updated_by = userId;

    await sequelize.transaction(async (transaction) => {
        await plan.update(payload, { transaction });
        // Only rewrite menus when the request actually carries them — a status
        // toggle must not wipe the plan's menu selection.
        if (data.menus !== undefined) {
            await syncPlanMenus(plan.id, data.menus, transaction);
        }
    });

    logger.logDB('update', MODEL_NAME, id);
    await logger.logActivity(userId, 'update', MODEL_NAME, `Updated subscription plan: ${plan.name}`, {
        recordId: id,
        oldValues,
        newValues: payload,
        companyId,
    });

    return getById(id, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    await baseService.update(SubscriptionPlan, MODEL_NAME, id, { is_active: toBit(is_active, 1) }, userId, companyId);
    return getById(id, companyId);
};

/** Action-menu "Duplicate Plan" — copies the plan and every menu row. */
const duplicate = async (id, userId = null, companyId = undefined) => {
    const source = await SubscriptionPlan.findByPk(id, { include: [MENU_INCLUDE] });
    if (!source) throw ApiError.notFound('Subscription plan not found');
    if (companyId !== undefined && companyId !== null && source.company_id && source.company_id !== companyId) {
        throw ApiError.notFound('Subscription plan not found');
    }

    const src = source.toJSON();
    const payload = WRITABLE_FIELDS.reduce((acc, key) => {
        if (src[key] !== undefined) acc[key] = src[key];
        return acc;
    }, {});

    payload.name = `${src.name} (Copy)`;
    // Codes are unique, so the copy needs its own; -COPY, -COPY-2, …
    let candidate = `${src.plan_code}-COPY`;
    for (let i = 2; i < 100; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const clash = await SubscriptionPlan.findOne({
            where: { plan_code: candidate, ...(companyId ? { company_id: companyId } : {}) },
            attributes: ['id'],
        });
        if (!clash) break;
        candidate = `${src.plan_code}-COPY-${i}`;
    }
    payload.plan_code = candidate;

    const copy = await sequelize.transaction(async (transaction) => {
        if (companyId !== undefined && companyId !== null) payload.company_id = companyId;
        if (userId) payload.created_by = userId;

        const created = await SubscriptionPlan.create(payload, { transaction });
        await syncPlanMenus(created.id, src.planMenus || [], transaction);
        return created;
    });

    await logger.logActivity(userId, 'create', MODEL_NAME, `Duplicated plan #${id} as ${copy.name}`, {
        recordId: copy.id,
        companyId,
    });
    return getById(copy.id, companyId);
};

/**
 * Deactivate with a recorded reason — the Deactivate Plan screen.
 *
 * Distinct from updateStatus (the list's switch, which is a bare toggle): this
 * one demands a reason and stamps who/when, so the success screen has something
 * true to show.
 */
const deactivate = async (id, data = {}, userId = null, companyId = undefined) => {
    const reason = String(data.reason || '').trim();
    if (!reason) throw ApiError.badRequest('A reason for deactivation is required.');
    if (!REASONS.deactivation.includes(reason)) {
        throw ApiError.badRequest('Select a valid deactivation reason.');
    }

    const comments = String(data.comments || '').trim();
    if (comments.length > 300) throw ApiError.badRequest('Comments must be 300 characters or fewer.');

    await baseService.update(SubscriptionPlan, MODEL_NAME, id, {
        is_active: 0,
        deactivation_reason: reason,
        deactivation_comments: comments || null,
        deactivated_at: new Date(),
        deactivated_by: userId,
    }, userId, companyId);

    await logger.logActivity(userId, 'update', MODEL_NAME, `Deactivated plan #${id}: ${reason}`, {
        recordId: id,
        companyId,
    });
    return getById(id, companyId);
};

/**
 * Reactivating clears the deactivation record — leaving it behind would make
 * the view screen show a stale "deactivated on" for a live plan.
 */
const reactivate = async (id, userId = null, companyId = undefined) => {
    await baseService.update(SubscriptionPlan, MODEL_NAME, id, {
        is_active: 1,
        deactivation_reason: null,
        deactivation_comments: null,
        deactivated_at: null,
        deactivated_by: null,
    }, userId, companyId);
    return getById(id, companyId);
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    // subscription_plan_menus cascades on the FK, so the child rows go with it.
    return baseService.remove(SubscriptionPlan, MODEL_NAME, id, userId, companyId, {
        uniqueFields: ['plan_code'],
    });
};

/**
 * Delete with a recorded reason — the Delete Plan screen.
 *
 * Soft delete: the row survives with deleted_at set, so Deleted On / Deleted By
 * / Reason are still readable for the success screen and any later audit. It is
 * invisible everywhere in the app, which is what the admin experiences.
 *
 * Returns the plan as it looked *before* deletion, because the success screen
 * cannot re-fetch a soft-deleted row through the normal scoped read.
 */
const deleteWithReason = async (id, data = {}, userId = null, companyId = undefined) => {
    const reason = String(data.reason || '').trim();
    if (!reason) throw ApiError.badRequest('A reason for deletion is required.');
    if (!REASONS.deletion.includes(reason)) {
        throw ApiError.badRequest('Select a valid deletion reason.');
    }

    const comments = String(data.comments || '').trim();
    if (comments.length > 300) throw ApiError.badRequest('Comments must be 300 characters or fewer.');

    const snapshot = await getById(id, companyId);

    // Stamped first: once destroy() runs, the scoped update would no longer
    // find the row.
    await baseService.update(SubscriptionPlan, MODEL_NAME, id, {
        deletion_reason: reason,
        deletion_comments: comments || null,
        deleted_by: userId,
    }, userId, companyId);

    await baseService.remove(SubscriptionPlan, MODEL_NAME, id, userId, companyId, {
        uniqueFields: ['plan_code'],
    });

    await logger.logActivity(userId, 'delete', MODEL_NAME, `Deleted plan #${id}: ${reason}`, {
        recordId: id,
        companyId,
    });

    return {
        ...snapshot,
        deletion_reason: reason,
        deletion_comments: comments || null,
        deleted_at: new Date().toISOString(),
    };
};

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deactivate,
    reactivate,
    duplicate,
    deleteById,
    deleteWithReason,
    getReasons,
    REASONS,
    getLimitCatalog,
    limitsForMenu,
    LIMIT_CATALOG,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
