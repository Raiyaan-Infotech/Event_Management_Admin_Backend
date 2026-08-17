const { Sequelize, PlanBadge, PlanBadgePlan, SubscriptionPlan, sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const settingService = require('./setting.service');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const MODEL_NAME = 'PlanBadge';
const MODULE_SLUG = 'plan_badges';

// Whitelist, so a stray body key can never write company_id, created_by or an id.
const WRITABLE_FIELDS = ['text', 'style', 'color', 'apply_to', 'is_active', 'sort_order'];

const STYLES = ['default', 'rounded', 'pill', 'outline', 'soft', 'dashed'];

/** The "Recommended Badges" strip — one click adds a conventional badge. */
const RECOMMENDED = [
    { text: 'Most Popular', style: 'soft', color: '#16A34A' },
    { text: 'Best Value', style: 'outline', color: '#2563EB' },
    { text: 'Recommended', style: 'default', color: '#6E22FE' },
    { text: 'New', style: 'pill', color: '#F97316' },
    { text: 'Limited Time', style: 'dashed', color: '#E11D48' },
    { text: 'Premium', style: 'rounded', color: '#0D9488' },
];

const PLAN_INCLUDE = [
    {
        model: SubscriptionPlan,
        as: 'plans',
        attributes: ['id', 'name', 'plan_code'],
        through: { attributes: [] },
        required: false,
    },
];

const pickWritable = (data = {}) =>
    WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

const decorate = (row) => {
    const plain = row && row.toJSON ? row.toJSON() : { ...row };
    plain.plan_ids = Array.isArray(plain.plans) ? plain.plans.map((p) => p.id) : [];
    return plain;
};

/**
 * Rewrite which plans a badge is pinned to.
 *
 * Cleared entirely when apply_to is 'all' — leaving stale rows behind would
 * make a later switch back to 'selected' silently restore an old selection the
 * admin never re-confirmed.
 */
const syncBadgePlans = async (badgeId, applyTo, planIds, transaction) => {
    if (applyTo === 'all') {
        await PlanBadgePlan.destroy({ where: { badge_id: badgeId }, transaction });
        return;
    }
    if (!Array.isArray(planIds)) return;

    const ids = planIds.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n));

    await PlanBadgePlan.destroy({
        where: ids.length > 0
            ? { badge_id: badgeId, plan_id: { [Op.notIn]: ids } }
            : { badge_id: badgeId },
        transaction,
    });

    for (const planId of ids) {
        await PlanBadgePlan.findOrCreate({
            where: { badge_id: badgeId, plan_id: planId },
            defaults: { badge_id: badgeId, plan_id: planId },
            transaction,
        });
    }
};

const validate = (payload) => {
    if (payload.text !== undefined) {
        const text = String(payload.text).trim();
        if (!text) throw ApiError.badRequest('Badge text is required');
        // 25 is the column width and what the form's counter counts down from.
        if (text.length > 25) throw ApiError.badRequest('Badge text must be 25 characters or fewer.');
        payload.text = text;
    }
    if (payload.style !== undefined && !STYLES.includes(payload.style)) {
        throw ApiError.badRequest(`Badge style must be one of: ${STYLES.join(', ')}.`);
    }
    if (payload.apply_to !== undefined && !['all', 'selected'].includes(payload.apply_to)) {
        throw ApiError.badRequest('Apply To must be "all" or "selected".');
    }
};

const getAll = async (query = {}, companyId = undefined) => {
    const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

    const result = await baseService.getAll(PlanBadge, MODEL_NAME, listQuery, {
        searchFields: ['text'],
        sortableFields: ['sort_order', 'text', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: PLAN_INCLUDE,
    });

    return { ...result, data: result.data.map(decorate) };
};

const getById = async (id, companyId = undefined) => {
    const badge = await baseService.getById(PlanBadge, MODEL_NAME, id, {
        companyId,
        include: PLAN_INCLUDE,
    });
    return decorate(badge);
};

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);
    if (!payload.text) throw ApiError.badRequest('Badge text is required');
    validate(payload);

    const badge = await sequelize.transaction(async (transaction) => {
        if (companyId !== undefined && companyId !== null) payload.company_id = companyId;
        if (userId) payload.created_by = userId;

        const created = await PlanBadge.create(payload, { transaction });
        await syncBadgePlans(created.id, payload.apply_to ?? 'all', data.plan_ids, transaction);
        return created;
    });

    logger.logDB('create', MODEL_NAME, badge.id);
    await logger.logActivity(userId, 'create', MODEL_NAME, `Created badge: ${badge.text}`, {
        recordId: badge.id,
        companyId,
    });
    return getById(badge.id, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const badge = await PlanBadge.findByPk(id);
    if (!badge) throw ApiError.notFound('Badge not found');
    if (companyId !== undefined && companyId !== null && badge.company_id && badge.company_id !== companyId) {
        throw ApiError.notFound('Badge not found');
    }

    const payload = pickWritable(data);
    validate(payload);

    const oldValues = badge.toJSON();
    if (userId) payload.updated_by = userId;

    await sequelize.transaction(async (transaction) => {
        await badge.update(payload, { transaction });
        // Only touch the plan pins when the request carries them, or a status
        // toggle would wipe the badge's plan selection.
        if (data.plan_ids !== undefined || payload.apply_to !== undefined) {
            await syncBadgePlans(badge.id, payload.apply_to ?? badge.apply_to, data.plan_ids, transaction);
        }
    });

    logger.logDB('update', MODEL_NAME, id);
    await logger.logActivity(userId, 'update', MODEL_NAME, `Updated badge: ${badge.text}`, {
        recordId: id,
        oldValues,
        newValues: payload,
        companyId,
    });
    return getById(id, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    await baseService.update(PlanBadge, MODEL_NAME, id, { is_active: is_active ? 1 : 0 }, userId, companyId);
    return getById(id, companyId);
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    // plan_badge_plans cascades on the FK.
    return baseService.remove(PlanBadge, MODEL_NAME, id, userId, companyId);
};

/* ------------------------------------------------------- module settings -- */

const SETTING_KEYS = { enabled: 'plan_badges_enabled', position: 'plan_badge_position' };

const getSettings = async (companyId = undefined) => {
    const rows = await settingService.getByGroup('plan_badges', companyId).catch(() => []);
    const map = {};
    (Array.isArray(rows) ? rows : []).forEach((r) => { map[r.key] = r.value; });
    return {
        enabled: String(map[SETTING_KEYS.enabled] ?? '1') === '1',
        position: map[SETTING_KEYS.position] ?? 'top_right',
    };
};

const updateSettings = async (data = {}, userId = null, companyId = undefined) => {
    const payload = {};
    if (data.enabled !== undefined) payload[SETTING_KEYS.enabled] = data.enabled ? '1' : '0';
    if (data.position !== undefined) payload[SETTING_KEYS.position] = String(data.position);

    if (Object.keys(payload).length > 0) {
        await settingService.bulkUpdate(payload, 'plan_badges', userId, companyId);
    }
    return getSettings(companyId);
};

/** Counts for the Badge Usage Summary card. */
const getSummary = async (companyId = undefined) => {
    const where = {};
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const total = await PlanBadge.count({ where });
    const active = await PlanBadge.count({ where: { ...where, is_active: 1 } });
    return { total, active, inactive: total - active };
};

const getRecommended = () => RECOMMENDED;

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
    getSettings,
    updateSettings,
    getSummary,
    getRecommended,
    RECOMMENDED,
    STYLES,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
