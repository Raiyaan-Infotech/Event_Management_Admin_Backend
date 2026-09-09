const { Op } = require('sequelize');
const { NotificationTemplate, NotificationCategory, EventCategory, EventType } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'NotificationTemplate';
const MODULE_SLUG = 'notification_templates';

/**
 * Fixed placeholder set. Not DB-driven on purpose — these are the only
 * variables the system actually knows how to fill in when a template is
 * eventually used by a trigger (RSVP confirm, reminder, ...). A free-form
 * variable would render literally as "{{whatever}}" with nobody to blame.
 */
const AVAILABLE_VARIABLES = [
    { key: 'guest_name', label: '{{guest_name}}' },
    { key: 'event_name', label: '{{event_name}}' },
    { key: 'event_date', label: '{{event_date}}' },
    { key: 'event_time', label: '{{event_time}}' },
    { key: 'venue_name', label: '{{venue_name}}' },
    { key: 'event_link', label: '{{event_link}}' },
];
const AVAILABLE_VARIABLE_KEYS = new Set(AVAILABLE_VARIABLES.map((v) => v.key));

/**
 * The system events notificationTrigger.service.js actually knows how to
 * fire. Fixed on purpose, same reasoning as AVAILABLE_VARIABLES above: a
 * free-form trigger_key would never actually fire because no trigger
 * function is listening for it.
 */
const SYSTEM_TRIGGERS = [
    { key: 'welcome_invitation', label: 'Welcome Invitation (guest joins an event)' },
];
const SYSTEM_TRIGGER_KEYS = new Set(SYSTEM_TRIGGERS.map((t) => t.key));

const WRITABLE_FIELDS = [
    'name', 'trigger_key', 'notification_category_id', 'event_category_id', 'event_type_id',
    'title', 'content', 'image_url', 'channels', 'is_active', 'sort_order',
];

const pickWritable = (data = {}) =>
    WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

const toNullableId = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '' || value === 'null') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
};

/** Which of the fixed variables actually appear in the title/content text. */
const extractVariablesUsed = (title = '', content = '') => {
    const text = `${title} ${content}`;
    const found = new Set();
    const re = /\{\{\s*(\w+)\s*\}\}/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        if (AVAILABLE_VARIABLE_KEYS.has(match[1])) found.add(match[1]);
    }
    return Array.from(found);
};

const assertNotificationCategoryExists = async (notificationCategoryId) => {
    const cat = await NotificationCategory.findByPk(notificationCategoryId, { attributes: ['id'] });
    if (!cat) throw ApiError.badRequest('That notification category does not exist.');
};

const assertEventTypeMatchesCategory = async (eventCategoryId, eventTypeId) => {
    if (!eventTypeId) return;
    const eventType = await EventType.findByPk(eventTypeId, { attributes: ['id', 'event_category_id'] });
    if (!eventType) throw ApiError.badRequest('That event type does not exist.');
    if (eventCategoryId && eventType.event_category_id !== eventCategoryId) {
        throw ApiError.badRequest('That event type does not belong to the selected event category.');
    }
};

const normalizeTriggerKey = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '' || value === 'null') return null;
    if (!SYSTEM_TRIGGER_KEYS.has(value)) {
        throw ApiError.badRequest('That system trigger is not recognised.');
    }
    return value;
};

const assertTriggerKeyAvailable = async (triggerKey, excludeId = null) => {
    if (!triggerKey) return;
    const where = { trigger_key: triggerKey };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    const clash = await NotificationTemplate.findOne({ where, attributes: ['id', 'name'] });
    if (clash) {
        throw ApiError.badRequest(
            `"${clash.name}" already handles this system trigger. Clear it there first.`
        );
    }
};

const normalizeChannels = (channels) => {
    if (!Array.isArray(channels) || !channels.length) return ['in_app'];
    const allowed = new Set(['in_app', 'push']);
    const clean = channels.filter((c) => allowed.has(c));
    return clean.length ? clean : ['in_app'];
};

const getAll = async (query = {}, companyId = undefined) => {
    const where = {};
    const notificationCategoryId = toNullableId(query.notification_category_id);
    if (notificationCategoryId !== undefined) where.notification_category_id = notificationCategoryId;

    const eventCategoryId = toNullableId(query.event_category_id);
    if (eventCategoryId !== undefined) where.event_category_id = eventCategoryId;

    const eventTypeId = toNullableId(query.event_type_id);
    if (eventTypeId !== undefined) where.event_type_id = eventTypeId;

    return baseService.getAll(NotificationTemplate, MODEL_NAME, query, {
        searchFields: ['name', 'title', 'content'],
        sortableFields: ['sort_order', 'name', 'created_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        where,
        include: [
            { model: NotificationCategory, as: 'notificationCategory', attributes: ['id', 'name', 'icon', 'color'], required: false },
            { model: EventCategory, as: 'category', attributes: ['id', 'name'], required: false },
            { model: EventType, as: 'eventType', attributes: ['id', 'name'], required: false },
        ],
    });
};

const getById = async (id, companyId = undefined) =>
    baseService.getById(NotificationTemplate, MODEL_NAME, id, {
        companyId,
        include: [
            { model: NotificationCategory, as: 'notificationCategory', attributes: ['id', 'name', 'icon', 'color'], required: false },
            { model: EventCategory, as: 'category', attributes: ['id', 'name'], required: false },
            { model: EventType, as: 'eventType', attributes: ['id', 'name'], required: false },
        ],
    });

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pickWritable(data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('A template name is required.');
    }
    if (!payload.notification_category_id) {
        throw ApiError.badRequest('A notification category is required.');
    }
    if (!payload.title || !String(payload.title).trim()) {
        throw ApiError.badRequest('A title is required.');
    }
    if (!payload.content || !String(payload.content).trim()) {
        throw ApiError.badRequest('Message content is required.');
    }

    payload.name = String(payload.name).trim();
    payload.title = String(payload.title).trim();
    payload.notification_category_id = toNullableId(payload.notification_category_id);
    await assertNotificationCategoryExists(payload.notification_category_id);
    payload.event_category_id = toNullableId(payload.event_category_id) ?? null;
    payload.event_type_id = toNullableId(payload.event_type_id) ?? null;
    await assertEventTypeMatchesCategory(payload.event_category_id, payload.event_type_id);

    payload.channels = normalizeChannels(payload.channels);
    payload.variables_used = extractVariablesUsed(payload.title, payload.content);
    payload.trigger_key = normalizeTriggerKey(payload.trigger_key) ?? null;
    await assertTriggerKeyAvailable(payload.trigger_key);

    return baseService.create(NotificationTemplate, MODEL_NAME, payload, userId, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const row = await NotificationTemplate.findByPk(id);
    if (!row) throw ApiError.notFound('That notification template was not found.');

    const payload = pickWritable(data);

    if (payload.name !== undefined) {
        if (!String(payload.name).trim()) throw ApiError.badRequest('A template name is required.');
        payload.name = String(payload.name).trim();
    }
    if (payload.title !== undefined) {
        if (!String(payload.title).trim()) throw ApiError.badRequest('A title is required.');
        payload.title = String(payload.title).trim();
    }
    if (payload.content !== undefined && !String(payload.content).trim()) {
        throw ApiError.badRequest('Message content is required.');
    }
    if (payload.notification_category_id !== undefined) {
        payload.notification_category_id = toNullableId(payload.notification_category_id);
        if (!payload.notification_category_id) {
            throw ApiError.badRequest('A notification category is required.');
        }
        await assertNotificationCategoryExists(payload.notification_category_id);
    }

    if (payload.event_category_id !== undefined) payload.event_category_id = toNullableId(payload.event_category_id);
    if (payload.event_type_id !== undefined) payload.event_type_id = toNullableId(payload.event_type_id);

    const targetCategoryId = payload.event_category_id !== undefined ? payload.event_category_id : row.event_category_id;
    const targetTypeId = payload.event_type_id !== undefined ? payload.event_type_id : row.event_type_id;
    await assertEventTypeMatchesCategory(targetCategoryId, targetTypeId);

    if (payload.channels !== undefined) payload.channels = normalizeChannels(payload.channels);

    if (payload.trigger_key !== undefined) {
        payload.trigger_key = normalizeTriggerKey(payload.trigger_key);
        await assertTriggerKeyAvailable(payload.trigger_key, id);
    }

    if (payload.title !== undefined || payload.content !== undefined) {
        payload.variables_used = extractVariablesUsed(
            payload.title ?? row.title,
            payload.content ?? row.content,
        );
    }

    return baseService.update(NotificationTemplate, MODEL_NAME, id, payload, userId, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) =>
    baseService.update(NotificationTemplate, MODEL_NAME, id, { is_active: is_active ? 1 : 0 }, userId, companyId);

const deleteById = async (id, userId = null, companyId = undefined) =>
    baseService.remove(NotificationTemplate, MODEL_NAME, id, userId, companyId);

const duplicate = async (id, userId = null, companyId = undefined) => {
    const row = await NotificationTemplate.findByPk(id);
    if (!row) throw ApiError.notFound('That notification template was not found.');

    const clone = row.toJSON();
    delete clone.id;
    delete clone.created_at;
    delete clone.updated_at;
    delete clone.deleted_at;
    clone.name = `${clone.name} (Copy)`;
    clone.is_active = 0;
    // trigger_key is unique — the original keeps ownership of its system trigger.
    clone.trigger_key = null;

    return baseService.create(NotificationTemplate, MODEL_NAME, clone, userId, companyId ?? row.company_id);
};

const getAvailableVariables = () => AVAILABLE_VARIABLES;
const getSystemTriggers = () => SYSTEM_TRIGGERS;

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
    duplicate,
    getAvailableVariables,
    getSystemTriggers,
    extractVariablesUsed,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
