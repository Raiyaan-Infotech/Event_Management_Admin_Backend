const { Op } = require('sequelize');
const {
    Event,
    EventParticipant,
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
    // Account-level (not per event): the plan's Max Storage crossed 50% / 100%.
    STORAGE_HALF_FULL: 'storage_half_full',
    STORAGE_FULL: 'storage_full',
    PHOTOS_HALF_FULL: 'photos_half_full',
    PHOTOS_FULL: 'photos_full',
    VIDEOS_HALF_FULL: 'videos_half_full',
    VIDEOS_FULL: 'videos_full',
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
 * event's category. trigger_key is unique, so at most one row can match.
 */
const findApplicableTemplate = async (triggerKey, event) => {
    return NotificationTemplate.findOne({
        where: {
            trigger_key: triggerKey,
            is_active: 1,
            [Op.or]: [{ event_category_id: null }, { event_category_id: event.event_category_id }],
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
 * @param {Object} [params.guest] - Optional EventParticipant instance
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
                    'event_category_id',
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

        /*
          ── WHO IS PUSHED IS NOT WHO GETS THE RECORD ───────────────────────
          The set above is for the IN-APP feed, and putting the host in it is
          deliberate: they keep a copy of every invitation their event sent.

          A push is not a record, it is a message addressed to someone. This
          one is written TO the guest — "Welcome", their name, their event — so
          pushing it to the host makes their phone buzz with a greeting meant
          for somebody else. That is what reusing this set for push did.

          So the host is dropped, UNLESS they are also the person being
          welcomed: a host who joined their own event as a guest is a real
          case, and they should still be told.
        */
        const welcomedIds = new Set();
        if (guest?.participant_client_id) welcomedIds.add(Number(guest.participant_client_id));
        if (client?.id) welcomedIds.add(Number(client.id));
        const pushClientIds = welcomedIds.size ? welcomedIds : new Set();

        const effectiveCompanyId = companyId ?? event.company_id ?? template.company_id ?? 1;

        // Verify guestId exists in event_participants table to respect foreign key constraint
        let validGuestId = null;
        if (guest?.id) {
            const guestExists = await EventParticipant.findByPk(guest.id, { attributes: ['id'] });
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
                // `pushClientIds`, NOT `recipientClientIds` — see above.
                const clientIdsArray = Array.from(pushClientIds);
                if (!clientIdsArray.length) {
                    logger.info?.(
                        '[NotificationTrigger] No push recipient for this welcome invitation '
                        + '(the guest has not joined yet, so there is no account to send to).'
                    );
                }
                const activeTokens = clientIdsArray.length
                    ? await ClientDeviceToken.findAll({
                        where: {
                            website_client_id: { [Op.in]: clientIdsArray },
                            is_active: 1,
                        },
                        attributes: ['id', 'token'],
                    })
                    : [];

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

/** Built-in wording, used until an admin writes a template for the trigger. */
const USAGE_NOUN = { storage: 'storage', photos: 'photos', videos: 'videos' };
const usageDefaults = (kind, level) => {
    const noun = USAGE_NOUN[kind];
    if (kind === 'storage') {
        return level === 'full'
            ? {
                title: 'Your storage is full',
                content: 'You have used all {{storage_limit}} of your storage, so new photos and videos cannot be added. Delete some media or upgrade your plan.',
            }
            : {
                title: 'Your storage is {{storage_percent}}% full',
                content: 'You have used {{storage_used}} of your {{storage_limit}} storage. Delete some media or upgrade your plan before it runs out.',
            };
    }
    return level === 'full'
        ? {
            title: `Your ${noun} limit is full`,
            content: `"{{event_name}}" has used all {{usage_limit}} ${noun} on your plan, so no more can be added. Delete some or upgrade your plan.`,
        }
        : {
            title: `Your ${noun} limit is {{usage_percent}}% full`,
            content: `"{{event_name}}" has used {{usage_used}} of {{usage_limit}} ${noun} on your plan. Delete some or upgrade your plan before it runs out.`,
        };
};

const sizeText = (bytes) => {
    const mbVal = Number(bytes || 0) / (1024 * 1024);
    if (mbVal >= 1024) return `${(mbVal / 1024).toFixed(mbVal / 1024 >= 10 ? 0 : 1)} GB`;
    return `${mbVal.toFixed(mbVal >= 10 || mbVal === 0 ? 0 : 1)} MB`;
};

/**
 * Trigger: a plan allowance reached 50% or 100% - `kind` is storage (account
 * level, bytes) or photos / videos (per event, counts; shared by the Gallery
 * and Wed Wishes). Sent to the event's owner.
 *
 * Template = the one tagged `<kind>_half_full` / `<kind>_full` in the admin's
 * Notification Templates (e.g. `photos_half_full`). No template at all -> the
 * built-in wording above is used; a template that exists but is inactive ->
 * nothing is sent. There is no per-event on/off.
 *
 * Never throws: it runs after an upload that already succeeded.
 */
const triggerUsageAlert = async ({
    clientId, kind = 'storage', level, used, limit, eventName = '', companyId = null,
} = {}) => {
    try {
        if (!clientId || !(Number(limit) > 0) || !USAGE_NOUN[kind] || !['half', 'full'].includes(level)) {
            return { triggered: false, reason: 'bad_input' };
        }
        const key = `${kind}_${level === 'full' ? 'full' : 'half_full'}`;
        const template = await NotificationTemplate.findOne({
            where: { trigger_key: key },
            attributes: ['id', 'name', 'title', 'content', 'channels', 'image_url', 'is_active', 'company_id'],
        });
        if (template && !template.is_active) return { triggered: false, reason: 'template_inactive' };

        const percent = level === 'full'
            ? 100
            : Math.max(50, Math.min(99, Math.floor((Number(used) / Number(limit)) * 100)));
        const isBytes = kind === 'storage';
        const fmt = (n) => (isBytes ? sizeText(n) : String(Math.round(Number(n))));
        const left = Math.max(0, Number(limit) - Number(used));
        const variables = {
            guest_name: 'there',
            event_name: eventName || 'your event',
            usage_percent: String(percent),
            usage_used: fmt(used),
            usage_limit: fmt(limit),
            usage_left: fmt(left),
            storage_percent: String(percent),
            storage_used: fmt(used),
            storage_limit: fmt(limit),
            storage_left: fmt(left),
        };
        const source = template || usageDefaults(kind, level);
        const title = renderPlaceholders(source.title, variables);
        const body = renderPlaceholders(source.content, variables);
        const channels = template && Array.isArray(template.channels) && template.channels.length
            ? template.channels
            : ['in_app', 'push'];

        if (channels.includes('in_app')) {
            await notifications.notify(clientId, {
                type: 'storage_alert',
                title,
                body,
                companyId: companyId ?? template?.company_id ?? null,
                meta: { kind, level, percent, template_id: template?.id || null },
            });
        }
        if (channels.includes('push')) {
            const tokens = await ClientDeviceToken.findAll({
                where: { website_client_id: clientId, is_active: 1 },
                attributes: ['id', 'token'],
            });
            if (tokens.length) {
                await pushSender.sendToTokens(tokens, {
                    title,
                    body: body.replace(/\s+/g, ' ').trim(),
                    imageUrl: template?.image_url || undefined,
                    data: { type: 'storage_alert', kind, level },
                });
            }
        }
        return { triggered: true, kind, level, title };
    } catch (err) {
        logger.warn?.('[NotificationTrigger] usage alert failed (non-fatal):', err.message);
        return { triggered: false, reason: 'error', error: err.message };
    }
};

/** Storage-only wrapper, kept for callers / tests. */
const triggerStorageAlert = ({ usedBytes, limitBytes, ...rest } = {}) =>
    triggerUsageAlert({ ...rest, kind: 'storage', used: usedBytes, limit: limitBytes });

/** 'half' when 50% was crossed, 'full' when 100% was reached, else null. */
const crossingLevel = (before, after, limit) => {
    if (!(Number(limit) > 0)) return null;
    const b = Number(before) / Number(limit);
    const a = Number(after) / Number(limit);
    if (b < 1 && a >= 1) return 'full';
    if (b < 0.5 && a >= 0.5) return 'half';
    return null;
};

/**
 * Called after something was stored. Fires once when usage crosses 50% (and
 * again after it fell back under 50% and crossed anew) and once at 100%; jumping
 * over both sends only the full one. Fire and forget.
 */
const checkUsageCrossing = (clientId, kind, usedBefore, added, limit, extra = {}) => {
    if (!clientId) return;
    const level = crossingLevel(usedBefore, Number(usedBefore) + Number(added), limit);
    if (!level) return;
    triggerUsageAlert({
        clientId, kind, level, used: Number(usedBefore) + Number(added), limit: Number(limit), ...extra,
    });
};

const checkStorageCrossing = (clientId, usedBefore, added, limitBytes) =>
    checkUsageCrossing(clientId, 'storage', usedBefore, added, limitBytes);

module.exports = {
    triggerUsageAlert,
    checkUsageCrossing,
    triggerStorageAlert,
    checkStorageCrossing,
    triggerWelcomeInvitation,
    isTemplateEnabledForEvent,
    findApplicableTemplate,
    renderPlaceholders,
    TEMPLATE_TRIGGER_KEYS,
};
