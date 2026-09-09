const { Op } = require('sequelize');
const {
    Event,
    EventGuest,
    NotificationTemplate,
    EventNotificationTemplatePref,
    ClientDeviceToken,
} = require('../models');
const notifications = require('./clientNotification.service');
const pushSender = require('./pushSender.service');
const logger = require('../utils/logger');

/**
 * System-triggered notifications driven by the NotificationTemplate catalogue.
 *
 * ── ARCHITECTURE ────────────────────────────────────────────────────────────
 * 1. Admin defines the catalogue (NotificationTemplate) with dynamic placeholders.
 * 2. Client configures per-event overrides in EventNotificationTemplatePref
 *    ("no row = enabled", explicit `enabled = false` silences that template).
 * 3. When an event trigger fires (e.g. "Welcome Invitation" when a new user/guest
 *    comes in), this service checks:
 *    - Does an active template exist and apply to this event's category/type?
 *    - Did the client turn it OFF in the client portal for this event?
 *      If OFF -> abort immediately, do NOT send or show.
 *      If ON  -> render placeholders and dispatch via the template's channels
 *                (in_app -> ClientNotification, push -> FCM via pushSender).
 */

/**
 * Machine keys, matched exactly against `notification_templates.trigger_key`
 * (set by the admin from a fixed dropdown — see notificationTemplate.service.js's
 * SYSTEM_TRIGGERS). Never matched against `name`: a template's display name
 * can be freely renamed without this lookup breaking.
 *
 * Only WELCOME_INVITATION has an implementing trigger function below; the
 * other three are reserved keys for triggers not yet built.
 */
const TEMPLATE_TRIGGER_KEYS = {
    WELCOME_INVITATION: 'welcome_invitation',
    RSVP_CONFIRMATION: 'rsvp_confirmation',
    RSVP_DECLINED: 'rsvp_declined',
    REMINDER_24H: 'reminder_24h',
};

/** Formats a date string nicely for human notification reading. */
const formatDate = (dateVal) => {
    if (!dateVal) return '';
    try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return String(dateVal);
        return d.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    } catch {
        return String(dateVal);
    }
};

/** Substitutes {{key}} placeholders in template text. */
const renderPlaceholders = (text, vars = {}) =>
    String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => vars[key] ?? match);

/**
 * Finds the active template tagged with this trigger_key, applicable to this
 * event's category/type. trigger_key is unique, so at most one row can match.
 */
const findApplicableTemplate = async (triggerKey, event) => {
    return NotificationTemplate.findOne({
        where: {
            trigger_key: triggerKey,
            is_active: 1,
            [Op.and]: [
                { [Op.or]: [{ event_category_id: null }, { event_category_id: event.event_category_id }] },
                { [Op.or]: [{ event_type_id: null }, { event_type_id: event.event_type_id }] },
            ],
        },
        include: [
            { association: 'notificationCategory', attributes: ['id', 'name', 'icon', 'color'] },
        ],
        order: [
            ['sort_order', 'ASC'],
            ['id', 'ASC'],
        ],
    });
};

/**
 * Checks whether this template is enabled for this event by consulting the
 * client's per-event overrides in `event_notification_template_prefs`.
 *
 * Convention: "No row = ON". Only an explicit `enabled = false` silences it.
 */
const isTemplateEnabledForEvent = async (eventId, templateId) => {
    const pref = await EventNotificationTemplatePref.findOne({
        where: {
            event_id: eventId,
            notification_template_id: templateId,
        },
        attributes: ['enabled'],
    });

    if (pref && !pref.enabled) {
        return false;
    }
    return true;
};

/**
 * Trigger: Welcome Invitation.
 *
 * Fires when a new user/guest comes in (e.g. self-registration via QR code,
 * host adding a new guest in the portal, or joining the event).
 *
 * ⚠ "when client portal i off that welcom invitation not showing okay mind it"
 * If the client turned OFF this template for this event in the client portal,
 * this function exits early without recording any notification or sending push.
 *
 * @param {Object} params
 * @param {number} [params.eventId]
 * @param {Object} [params.event] - Optional loaded Event model instance
 * @param {Object} [params.guest] - Optional EventGuest instance
 * @param {Object} [params.client] - Optional WebsiteClient instance (participant or scanner)
 * @param {number} [params.companyId]
 * @returns {Promise<Object>} Outcome summary
 */
const triggerWelcomeInvitation = async ({
    eventId,
    event: providedEvent = null,
    guest = null,
    client = null,
    companyId = null,
} = {}) => {
    try {
        const targetEventId = providedEvent?.id || eventId || guest?.event_id;
        if (!targetEventId) {
            return { triggered: false, reason: 'missing_event_id' };
        }

        // 1. Resolve event details
        let event = providedEvent;
        if (!event) {
            event = await Event.findByPk(targetEventId, {
                attributes: [
                    'id', 'name', 'start_date', 'start_time', 'venue_name',
                    'venue_address', 'website_client_id', 'company_id',
                    'event_category_id', 'event_type_id',
                ],
            });
        }
        if (!event) {
            return { triggered: false, reason: 'event_not_found' };
        }

        // 2. Find applicable "Welcome Invitation" template
        const template = await findApplicableTemplate(TEMPLATE_TRIGGER_KEYS.WELCOME_INVITATION, event);
        if (!template) {
            logger.info?.(`[NotificationTrigger] No active Welcome Invitation template found for event ${event.id}`);
            return { triggered: false, reason: 'template_not_found' };
        }

        // 3. Check client portal preference for this event
        const isEnabled = await isTemplateEnabledForEvent(event.id, template.id);
        if (!isEnabled) {
            logger.info?.(
                `[NotificationTrigger] "${template.name}" (ID ${template.id}) is disabled in client portal for event ${event.id}. Skipping Welcome Invitation.`
            );
            return { triggered: false, reason: 'disabled_by_client_portal' };
        }

        // 4. Interpolate template variables
        const guestName = guest?.name || client?.name || 'Guest';
        const venue = event.venue_name || event.venue_address || 'Event Venue';
        const variables = {
            guest_name: guestName,
            event_name: event.name || 'Our Event',
            event_date: formatDate(event.start_date),
            event_time: event.start_time || '',
            venue_name: venue,
            event_link: `eventinvit.app/e/${event.id}`,
        };

        const renderedTitle = renderPlaceholders(template.title, variables);
        const renderedBody = renderPlaceholders(template.content, variables);
        const channels = Array.isArray(template.channels) && template.channels.length
            ? template.channels
            : ['in_app', 'push'];

        // 5. Determine in-app notification recipients
        // Both the client/host and the participant/guest should have the record available
        const recipientClientIds = new Set();
        if (event.website_client_id) recipientClientIds.add(Number(event.website_client_id));
        if (guest?.participant_client_id) recipientClientIds.add(Number(guest.participant_client_id));
        if (client?.id) recipientClientIds.add(Number(client.id));

        const effectiveCompanyId = companyId ?? event.company_id ?? template.company_id ?? 1;

        // Verify guestId exists in event_guests table to respect foreign key constraint
        let validGuestId = null;
        if (guest?.id) {
            const guestExists = await EventGuest.findByPk(guest.id, { attributes: ['id'] });
            if (guestExists) validGuestId = guest.id;
        }

        // Dispatch In-App Notifications
        if (channels.includes('in_app')) {
            for (const recipientId of recipientClientIds) {
                await notifications.notify(recipientId, {
                    type: 'welcome_invitation',
                    title: renderedTitle,
                    body: renderedBody,
                    eventId: event.id,
                    guestId: validGuestId,
                    companyId: effectiveCompanyId,
                    link: validGuestId ? `/dashboard/guests/${validGuestId}` : `/dashboard/events/${event.id}`,
                    meta: {
                        template_id: template.id,
                        template_name: template.name,
                        guest_name: variables.guest_name,
                        event_name: variables.event_name,
                        channels,
                    },
                });
            }
        }

        // Dispatch Push Notification (if push channel is configured)
        if (channels.includes('push')) {
            try {
                const clientIdsArray = Array.from(recipientClientIds);
                const activeTokens = await ClientDeviceToken.findAll({
                    where: {
                        website_client_id: { [Op.in]: clientIdsArray },
                        is_active: 1,
                    },
                    attributes: ['id', 'token'],
                });

                if (activeTokens.length > 0) {
                    logger.info?.(
                        `[NotificationTrigger] Dispatching push notification to ${activeTokens.length} active device(s) for client(s) [${clientIdsArray.join(', ')}]...`
                    );
                    // Mobile notification trays truncate after the first newline and show "...".
                    // Cleanly format pushBody for the tray preview while in-app keeps full formatting.
                    const pushBody = renderedBody
                        .replace(/\r\n/g, '\n')
                        .replace(/\n\s*\n/g, ' · ')
                        .replace(/\n/g, ' ')
                        .replace(/\s{2,}/g, ' ')
                        .trim();

                    const pushResults = await pushSender.sendToTokens(activeTokens, {
                        title: renderedTitle,
                        body: pushBody,
                        imageUrl: template.image_url || undefined,
                        deepLink: `/dashboard/events/${event.id}`,
                        data: {
                            event_id: String(event.id),
                            template_id: String(template.id),
                            type: 'welcome_invitation',
                        },
                    });
                    const succeeded = pushResults.filter((r) => r.ok).length;
                    logger.info?.(
                        `[NotificationTrigger] Push notification delivery result: ${succeeded}/${activeTokens.length} delivered`
                    );
                } else {
                    logger.info?.(
                        `[NotificationTrigger] Push skipped: No active device tokens found for client(s) [${clientIdsArray.join(', ')}]`
                    );
                }
            } catch (pushErr) {
                logger.warn?.('[NotificationTrigger] Push notification delivery error (non-fatal):', pushErr.message);
            }
        }

        logger.info?.(
            `[NotificationTrigger] Triggered "${template.name}" for event ${event.id} to clients [${Array.from(recipientClientIds).join(', ')}]`
        );

        return {
            triggered: true,
            template: { id: template.id, name: template.name },
            title: renderedTitle,
            recipients: Array.from(recipientClientIds),
        };
    } catch (err) {
        logger.error?.('[NotificationTrigger] Unexpected error in triggerWelcomeInvitation:', err.message);
        return { triggered: false, reason: 'error', error: err.message };
    }
};

module.exports = {
    triggerWelcomeInvitation,
    isTemplateEnabledForEvent,
    findApplicableTemplate,
    renderPlaceholders,
    TEMPLATE_TRIGGER_KEYS,
};
