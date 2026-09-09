const { Op } = require('sequelize');
const { Event, NotificationTemplate, EventNotificationTemplatePref } = require('../models');

/**
 * A client's per-event view/control of the admin notification catalogue.
 *
 * The catalogue itself (NotificationTemplate) is admin-only; this layer only
 * ever READS it and writes to EventNotificationTemplatePref, the per-event
 * override table. See that model's header for why "no row = on".
 */

/** Same ownership idiom as clientEvent.service.js's getEventById — id and
 * owner filtered together, never a separate "does it belong to them" check. */
const findOwnedEvent = async (clientId, eventId) =>
    Event.findOne({
        where: { id: eventId, website_client_id: clientId },
        attributes: ['id', 'website_client_id', 'event_category_id', 'event_type_id', 'name', 'status', 'updated_at'],
    });

/** Templates admin has scoped to apply to this event's category/type (or globally). */
const applicableTemplatesFor = (event) =>
    NotificationTemplate.findAll({
        where: {
            is_active: 1,
            [Op.and]: [
                { [Op.or]: [{ event_category_id: null }, { event_category_id: event.event_category_id }] },
                { [Op.or]: [{ event_type_id: null }, { event_type_id: event.event_type_id }] },
            ],
        },
        include: [
            { association: 'notificationCategory', attributes: ['id', 'name', 'icon', 'color'] },
            { association: 'category', attributes: ['id', 'name'] },
            { association: 'eventType', attributes: ['id', 'name'] },
        ],
        order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });

/**
 * The templates that apply to one event, merged with this client's overrides.
 * Returns null if the event does not exist or is not owned by this client.
 */
const listApplicable = async (clientId, eventId) => {
    const event = await findOwnedEvent(clientId, eventId);
    if (!event) return null;

    const [templates, overrides] = await Promise.all([
        applicableTemplatesFor(event),
        EventNotificationTemplatePref.findAll({
            where: { event_id: event.id },
            attributes: ['notification_template_id', 'enabled'],
        }),
    ]);

    const overrideByTemplateId = new Map(overrides.map((o) => [o.notification_template_id, o]));

    return {
        event: { id: event.id, name: event.name, status: event.status },
        templates: templates.map((t) => {
            const override = overrideByTemplateId.get(t.id);
            return {
                id: t.id,
                name: t.name,
                title: t.title,
                content: t.content,
                image_url: t.image_url,
                notificationCategory: t.notificationCategory,
                category: t.category,
                eventType: t.eventType,
                enabled: override ? override.enabled : true,
                is_set: Boolean(override),
            };
        }),
    };
};

/**
 * Turn one template on/off for one event.
 *
 * Re-checks BOTH ownership and applicability — a client cannot toggle a
 * template that does not even apply to their event's category/type, and
 * cannot toggle a template attached to somebody else's event.
 */
const toggle = async (clientId, eventId, templateId, enabled) => {
    const event = await findOwnedEvent(clientId, eventId);
    if (!event) return null;

    const templates = await applicableTemplatesFor(event);
    const applies = templates.some((t) => t.id === Number(templateId));
    if (!applies) return null;

    const [row] = await EventNotificationTemplatePref.findOrCreate({
        where: { event_id: event.id, notification_template_id: templateId },
        defaults: { website_client_id: clientId, enabled: !!enabled },
    });
    if (row.enabled !== !!enabled) {
        row.enabled = !!enabled;
        await row.save();
    }

    return { template_id: Number(templateId), enabled: row.enabled };
};

/**
 * Screen 1 — every one of this client's events with a template count and an
 * active/inactive split. Three queries total regardless of how many events
 * the client has: prod is ~374ms/query, so per-event queries would be slow.
 */
const summaryForClient = async (clientId) => {
    const [events, templates, overrides] = await Promise.all([
        Event.findAll({
            where: { website_client_id: clientId },
            attributes: ['id', 'name', 'event_category_id', 'event_type_id', 'status', 'updated_at'],
            include: [
                { association: 'category', attributes: ['id', 'name'] },
                { association: 'eventType', attributes: ['id', 'name'] },
            ],
            order: [['updated_at', 'DESC']],
        }),
        NotificationTemplate.findAll({
            where: { is_active: 1 },
            attributes: ['id', 'event_category_id', 'event_type_id'],
        }),
        EventNotificationTemplatePref.findAll({
            where: { website_client_id: clientId },
            attributes: ['event_id', 'notification_template_id', 'enabled'],
        }),
    ]);

    const overridesByEvent = new Map();
    overrides.forEach((o) => {
        if (!overridesByEvent.has(o.event_id)) overridesByEvent.set(o.event_id, new Map());
        overridesByEvent.get(o.event_id).set(o.notification_template_id, o.enabled);
    });

    const matches = (template, event) =>
        (template.event_category_id === null || template.event_category_id === event.event_category_id) &&
        (template.event_type_id === null || template.event_type_id === event.event_type_id);

    const rows = events.map((event) => {
        const applicable = templates.filter((t) => matches(t, event));
        const eventOverrides = overridesByEvent.get(event.id) ?? new Map();
        const inactiveCount = applicable.filter((t) => eventOverrides.get(t.id) === false).length;

        return {
            id: event.id,
            name: event.name,
            status: event.status,
            category: event.category ?? null,
            eventType: event.eventType ?? null,
            templates_count: applicable.length,
            active_count: applicable.length - inactiveCount,
            inactive_count: inactiveCount,
            updated_at: event.updated_at,
        };
    });

    return {
        events: rows,
        totals: {
            total_events: rows.length,
            total_templates: rows.reduce((sum, r) => sum + r.templates_count, 0),
            active_templates: rows.reduce((sum, r) => sum + r.active_count, 0),
            inactive_templates: rows.reduce((sum, r) => sum + r.inactive_count, 0),
        },
    };
};

module.exports = {
    listApplicable,
    toggle,
    summaryForClient,
};
