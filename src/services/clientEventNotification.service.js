const {
    Sequelize, Event, EventParticipant, EventNotification, EventNotificationRecipient,
    ClientDeviceToken, WebsiteClient,
} = require('../models');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const mediaService = require('./media.service');
const pushSender = require('./pushSender.service');
const feed = require('./clientNotification.service');

const { Op } = Sequelize;

/**
 * The organizer's notifications from the mobile app (Home → Send
 * Notification): write one, pick who gets it, send it now or schedule it.
 *
 * Own tables — `event_notifications` + `event_notification_recipients` — and
 * NOT the portal's `event_message_campaigns` (decided by Jamal, 2026-10-13).
 * Delivery goes through the same `pushSender` and the same active Firebase
 * config as everything else.
 *
 * Host-only: every call resolves the event or the notification by the
 * signed-in client, so "not found" and "not yours" are one answer.
 *
 * ── CHANNELS: 'in_app' AND / OR 'push' ──────────────────────────────────────
 * The organizer ticks one or both. Whatever is ticked, one recipient row is
 * written per participant — that row IS the in-app notification, and the
 * delivery record of the push.
 *   push    → sent through `pushSender` to the participant's devices.
 *   in_app  → nothing more to do today: the row is saved, and the page that
 *             will show it to the participant is a later step (Jamal,
 *             2026-10-13). That page reads `event_notification_recipients`
 *             joined to a notification whose `channels` holds 'in_app'.
 *
 * ── WHAT "SENT" MEANS HERE ──────────────────────────────────────────────────
 * The notification was SAVED for each participant. `delivered_count` is how
 * many of them it actually reached: with push ticked, those a device of whose
 * accepted it; in-app only, those who have an app account to read it in. A
 * send that reached nobody is still 'sent', and says so in its counts.
 *
 * ── THE BELL ────────────────────────────────────────────────────────────────
 * Every participant with an app account also gets a row in
 * `client_notifications` — the feed behind the app's bell — whichever channel
 * was ticked, so what the organizer sent is in the participant's list
 * (Jamal, 2026-10-13). Written once, in bulk, after the recipient rows.
 */

const TITLE_MAX = 100;
const MESSAGE_MAX = 500;
const AUDIENCES = ['all', 'specific', 'groups'];
const SIDES = ['bride', 'groom'];
/** What the organizer can tick. Email and WhatsApp are not delivered. */
const CHANNELS = ['in_app', 'push'];
const ACTIONS = ['draft', 'send', 'schedule'];
const EDITABLE = ['draft', 'scheduled'];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MEDIA_URL = /^(https?:\/\/|\/uploads\/)/i;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
/** "(GMT +05:30) India Standard Time" / "Hawaii (GMT-10:00)". */
const GMT_OFFSET = /GMT\s*([+-])\s*(\d{1,2}):(\d{2})/i;

const EVENT_ATTRS = ['id', 'name', 'company_id', 'website_client_id'];
const PARTICIPANT_ATTRS = ['id', 'name', 'photo', 'relationship', 'rsvp_side', 'participant_client_id'];

const pad = (n) => String(n).padStart(2, '0');

/** Minutes east of GMT that a time zone label states; null when it states none. */
const offsetMinutes = (label) => {
    const m = GMT_OFFSET.exec(String(label || ''));
    if (!m) return null;
    const minutes = Number(m[2]) * 60 + Number(m[3]);
    return m[1] === '-' ? -minutes : minutes;
};

/** The instant a wall-clock date + time is, read in [timezone]. */
const instantOf = (date, time, timezone) => {
    const d = DATE.exec(String(date || ''));
    const t = TIME.exec(String(time || ''));
    const offset = offsetMinutes(timezone);
    if (!d || !t || offset === null) return null;
    const utc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
    return new Date(utc - offset * 60_000);
};

/** The wall-clock date + time an instant is, read in [timezone]. */
const wallClock = (instant, timezone) => {
    const offset = offsetMinutes(timezone);
    if (!instant || offset === null) return { date: null, time: null };
    const shifted = new Date(new Date(instant).getTime() + offset * 60_000);
    return {
        date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
        time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    };
};

const listOf = (raw) => {
    let list = raw;
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch { list = []; }
    }
    return Array.isArray(list) ? list : [];
};

/** The event, proven to belong to this client. */
const resolveEvent = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');
    const event = await Event.findOne({
        where: { id: eventId, website_client_id: clientId },
        attributes: EVENT_ATTRS,
    });
    if (!event) throw ApiError.notFound('That event is not on your account.');
    return event;
};

/** A notification the caller wrote, or 404. */
const resolveNotification = async (clientId, id) => {
    const row = await EventNotification.findOne({
        where: { id: Number(id) || 0, website_client_id: clientId },
    });
    if (!row) throw ApiError.notFound('That notification was not found.');
    return row;
};

const shape = (row) => {
    const clock = wallClock(row.scheduled_at, row.timezone);
    return {
        id: row.id,
        event_id: row.event_id,
        title: row.title,
        message: row.message || '',
        image_url: row.image_url || null,
        audience: row.audience,
        participant_ids: listOf(row.participant_ids).map(Number).filter(Boolean),
        sides: listOf(row.sides),
        relationships: listOf(row.relationships),
        channels: listOf(row.channels),
        status: row.status,
        scheduled_at: row.scheduled_at || null,
        scheduled_date: clock.date,
        scheduled_time: clock.time,
        timezone: row.timezone || null,
        sent_at: row.sent_at || null,
        recipients_count: row.recipients_count,
        delivered_count: row.delivered_count,
        failed_count: row.failed_count,
        failed_reason: row.failed_reason || null,
        created_at: row.created_at,
    };
};

/** Who the stored audience is right now. */
const resolveAudience = async (eventId, fields) => {
    const where = { event_id: eventId };
    if (fields.audience === 'specific') {
        const ids = listOf(fields.participant_ids).map(Number).filter(Boolean);
        if (!ids.length) return [];
        where.id = { [Op.in]: ids };
    } else if (fields.audience === 'groups') {
        const sides = listOf(fields.sides).filter((s) => SIDES.includes(s));
        const relationships = listOf(fields.relationships);
        // Both sides ticked = every side, including a participant with none.
        if (sides.length === 1) where.rsvp_side = sides[0];
        if (relationships.length) where.relationship = { [Op.in]: relationships };
    }
    return EventParticipant.findAll({ where, attributes: PARTICIPANT_ATTRS, order: [['name', 'ASC']] });
};

/**
 * The body as stored columns. A draft needs a title and nothing else; anything
 * that is going out is checked in full.
 */
const readFields = (body = {}, action) => {
    const draft = action === 'draft';

    const title = String(body.title ?? '').trim();
    if (!title) throw ApiError.badRequest('Please enter a notification title.');
    if (title.length > TITLE_MAX) {
        throw ApiError.badRequest(`The title can be at most ${TITLE_MAX} characters.`);
    }

    const message = String(body.message ?? '').trim();
    if (!message && !draft) throw ApiError.badRequest('Please write a message.');
    if (message.length > MESSAGE_MAX) {
        throw ApiError.badRequest(`The message can be at most ${MESSAGE_MAX} characters.`);
    }

    const image = String(body.image_url ?? '').trim();
    if (image && !MEDIA_URL.test(image)) throw ApiError.badRequest('That image is not valid.');

    const audience = AUDIENCES.includes(body.audience) ? body.audience : 'all';
    const participantIds = [...new Set(listOf(body.participant_ids).map(Number).filter(Boolean))];
    const sides = [...new Set(listOf(body.sides).filter((s) => SIDES.includes(s)))];
    const relationships = [...new Set(
        listOf(body.relationships).map((r) => String(r).trim().slice(0, 60)).filter(Boolean),
    )];

    // An app build from before channels could be chosen sends none: push, as
    // it was then.
    const asked = body.channels === undefined ? ['push'] : listOf(body.channels);
    const channels = CHANNELS.filter((c) => asked.includes(c));

    if (!draft) {
        if (!channels.length) {
            throw ApiError.badRequest('Please choose In-App, Push Notification or both.');
        }
        if (audience === 'specific' && !participantIds.length) {
            throw ApiError.badRequest('Please choose at least one participant.');
        }
        if (audience === 'groups' && !sides.length) {
            throw ApiError.badRequest('Please choose the bride side, the groom side or both.');
        }
    }

    return {
        title,
        message: message || null,
        image_url: image || null,
        audience,
        participant_ids: audience === 'specific' ? participantIds : null,
        sides: audience === 'groups' ? sides : null,
        relationships: audience === 'groups' ? relationships : null,
        channels,
    };
};

/** Date + time + zone of a scheduled send, proven to be in the future. */
const readSchedule = (body = {}) => {
    const timezone = String(body.timezone ?? '').trim().slice(0, 80);
    if (!body.scheduled_date || !body.scheduled_time || !timezone) {
        throw ApiError.badRequest('Please choose the date, the time and the time zone.');
    }
    const at = instantOf(body.scheduled_date, body.scheduled_time, timezone);
    if (!at) throw ApiError.badRequest('That date, time or time zone is not valid.');
    if (at.getTime() <= Date.now()) {
        throw ApiError.badRequest('That time has already passed. Choose a later time.');
    }
    return { scheduled_at: at, timezone };
};

/**
 * Send a notification that is already saved as 'sending': push it, write one
 * recipient row per participant, and put the outcome on the notification.
 *
 * The push runs BEFORE the rows are written so each row is inserted once with
 * its final status — one bulk insert, not an insert and then an update per
 * outcome (production is ~374ms a query).
 */
const deliver = async (notification, event) => {
    const participants = await resolveAudience(event.id, notification);
    if (!participants.length) {
        await notification.update({
            status: 'failed',
            failed_reason: 'Nobody matches the chosen audience.',
            recipients_count: 0,
        });
        return { recipients: 0, delivered: 0, failed: 0 };
    }

    // Rows written before channels could be chosen were push-only.
    const stored = listOf(notification.channels);
    const push = !stored.length || stored.includes('push');

    const clientIds = [...new Set(
        participants.map((p) => Number(p.participant_client_id)).filter(Boolean),
    )];
    const tokens = push && clientIds.length
        ? await ClientDeviceToken.findAll({
            where: { website_client_id: { [Op.in]: clientIds }, is_active: true },
            attributes: ['id', 'website_client_id', 'token'],
        })
        : [];

    const results = tokens.length
        ? await pushSender.sendToTokens(tokens, {
            title: notification.title,
            body: notification.message || '',
            // FCM fetches the image itself, so only a full URL is of any use.
            imageUrl: /^https?:\/\//i.test(notification.image_url || '') ? notification.image_url : null,
            deepLink: `eventinvit://event/${event.id}`,
            data: {
                type: 'event_notification',
                event_notification_id: notification.id,
                event_id: event.id,
            },
        })
        : [];

    /* client id -> did any of their devices accept it, and if not, why. */
    const byToken = new Map(results.map((r) => [r.deviceTokenId, r]));
    const byClient = new Map();
    for (const t of tokens) {
        const key = Number(t.website_client_id);
        const outcome = byToken.get(t.id);
        const seen = byClient.get(key) || { ok: false, reason: null };
        if (outcome?.ok) seen.ok = true;
        else if (!seen.reason) seen.reason = outcome?.reason || null;
        byClient.set(key, seen);
    }

    const now = new Date();
    let delivered = 0;
    const rows = participants.map((p) => {
        const clientId = Number(p.participant_client_id) || null;
        const outcome = clientId ? byClient.get(clientId) : null;
        // Push ticked: a device accepted it. In-app only: they have the app
        // account the notification is saved against.
        const ok = push ? Boolean(outcome?.ok) : Boolean(clientId);
        if (ok) delivered += 1;
        return {
            notification_id: notification.id,
            event_id: event.id,
            participant_id: p.id,
            participant_client_id: clientId,
            status: ok ? 'sent' : 'failed',
            sent_at: ok ? now : null,
            failed_reason: ok
                ? null
                : String(
                    !clientId
                        ? 'Has not joined the app yet'
                        : outcome?.reason || 'No active device',
                ).slice(0, 255),
        };
    });

    for (let i = 0; i < rows.length; i += 500) {
        // eslint-disable-next-line no-await-in-loop
        await EventNotificationRecipient.bulkCreate(rows.slice(i, i + 500), { ignoreDuplicates: true });
    }

    /*
      The bell. One feed row per ACCOUNT (not per participant row — somebody on
      the list twice must not see it twice), in a single insert.
    */
    const accounts = [...new Set(rows.map((r) => r.participant_client_id).filter(Boolean))];
    await feed.notifyMany(accounts.map((clientId) => ({
        clientId,
        type: 'event_notification',
        title: notification.title,
        body: notification.message || null,
        eventId: event.id,
        companyId: event.company_id ?? null,
        link: `eventinvit://event/${event.id}`,
        meta: {
            event_notification_id: notification.id,
            image_url: notification.image_url || null,
            channels: stored.length ? stored : ['push'],
        },
    })));

    const failed = rows.length - delivered;
    /* Worth a line of its own when NOTHING went out for one shared reason
       (no Firebase config, say) — otherwise the counts tell the story. */
    const reasons = new Set(results.filter((r) => !r.ok).map((r) => r.reason));
    await notification.update({
        status: 'sent',
        sent_at: now,
        recipients_count: rows.length,
        delivered_count: delivered,
        failed_count: failed,
        failed_reason: !delivered && reasons.size === 1 ? String([...reasons][0]).slice(0, 255) : null,
    });

    return { recipients: rows.length, delivered, failed, push };
};

/** Save [fields] as a draft, a scheduled send, or send it now. */
const commit = async (clientId, event, existing, body) => {
    const action = ACTIONS.includes(body?.action) ? body.action : 'draft';
    const fields = readFields(body, action);

    if (action === 'draft') {
        const values = {
            ...fields, status: 'draft', scheduled_at: null, timezone: null, recipients_count: 0,
        };
        const row = existing
            ? await existing.update(values)
            : await EventNotification.create({
                ...values, event_id: event.id, website_client_id: clientId, company_id: event.company_id ?? null,
            });
        return { notification: shape(row), outcome: null };
    }

    const audience = await resolveAudience(event.id, fields);
    if (!audience.length) throw ApiError.badRequest('Nobody matches the chosen audience.');

    if (action === 'schedule') {
        const values = {
            ...fields, ...readSchedule(body), status: 'scheduled', recipients_count: audience.length,
        };
        const row = existing
            ? await existing.update(values)
            : await EventNotification.create({
                ...values, event_id: event.id, website_client_id: clientId, company_id: event.company_id ?? null,
            });
        return { notification: shape(row), outcome: null };
    }

    const values = {
        ...fields, status: 'sending', scheduled_at: null, timezone: null, recipients_count: audience.length,
    };
    const row = existing
        ? await existing.update(values)
        : await EventNotification.create({
            ...values, event_id: event.id, website_client_id: clientId, company_id: event.company_id ?? null,
        });
    try {
        const outcome = await deliver(row, event);
        return { notification: shape(row), outcome };
    } catch (err) {
        logger.logError(err);
        await row.update({ status: 'failed', failed_reason: String(err.message).slice(0, 255) });
        throw err;
    }
};

const list = async (clientId, eventId) => {
    const event = await resolveEvent(clientId, eventId);
    const rows = await EventNotification.findAll({
        where: { event_id: event.id, website_client_id: clientId },
        order: [['created_at', 'DESC'], ['id', 'DESC']],
    });
    return { notifications: rows.map(shape) };
};

const getOne = async (clientId, id) => shape(await resolveNotification(clientId, id));

const create = async (clientId, eventId, body) => {
    const event = await resolveEvent(clientId, eventId);
    return commit(clientId, event, null, body);
};

const update = async (clientId, id, body) => {
    const row = await resolveNotification(clientId, id);
    if (!EDITABLE.includes(row.status)) {
        throw ApiError.badRequest('A notification that has been sent cannot be edited.');
    }
    const event = await resolveEvent(clientId, row.event_id);
    return commit(clientId, event, row, body);
};

const reschedule = async (clientId, id, body) => {
    const row = await resolveNotification(clientId, id);
    if (row.status !== 'scheduled') {
        throw ApiError.badRequest('Only a scheduled notification can be rescheduled.');
    }
    // Conditional, so a send the scheduler has just claimed is not moved.
    const [moved] = await EventNotification.update(
        readSchedule(body),
        { where: { id: row.id, status: 'scheduled' } },
    );
    if (!moved) throw ApiError.badRequest('That notification is already being sent.');
    return shape(await row.reload());
};

const remove = async (clientId, id) => {
    const row = await resolveNotification(clientId, id);
    if (row.status === 'sending') {
        throw ApiError.badRequest('That notification is being sent. Try again in a moment.');
    }
    await row.destroy();
    return { id: row.id };
};

/**
 * What Select Audience picks from: the event's participants (for Specific
 * Participants), and the sides and relations they actually have (for
 * Participant Groups) with how many are in each.
 */
const audienceOptions = async (clientId, eventId) => {
    const event = await resolveEvent(clientId, eventId);
    const participants = await resolveAudience(event.id, { audience: 'all' });

    const sides = { bride: 0, groom: 0 };
    const relationships = new Map();
    for (const p of participants) {
        if (SIDES.includes(p.rsvp_side)) sides[p.rsvp_side] += 1;
        const relation = String(p.relationship || '').trim();
        if (relation) relationships.set(relation, (relationships.get(relation) || 0) + 1);
    }

    return {
        total: participants.length,
        sides: SIDES.map((key) => ({ key, count: sides[key] })),
        relationships: [...relationships.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, count]) => ({ name, count })),
        participants: participants.map((p) => ({
            id: p.id,
            name: p.name,
            photo: p.photo || null,
            side: p.rsvp_side || null,
            relationship: p.relationship || null,
            has_app: Boolean(p.participant_client_id),
        })),
    };
};

const uploadImage = async (clientId, eventId, file) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose an image to upload.');
    const event = await resolveEvent(clientId, eventId);
    if (!IMAGE_MIMES.includes(file.mimetype)) {
        throw ApiError.badRequest('Please choose a JPG, PNG or WEBP image.');
    }
    const client = await WebsiteClient.findByPk(clientId, { attributes: ['company_id'] });
    const stored = await mediaService.upload(
        file, { folder: `event-notifications/${event.id}` }, event.company_id || client?.company_id || 1,
    );
    if (!stored || !stored.url) throw ApiError.badRequest('That image could not be stored.');
    return { url: stored.url };
};

/**
 * The scheduler's way in: send every scheduled notification whose time has
 * come. Each is claimed with a conditional update first, so two ticks (or two
 * server instances) cannot both send it.
 */
const sendDue = async () => {
    const due = await EventNotification.findAll({
        where: { status: 'scheduled', scheduled_at: { [Op.ne]: null, [Op.lte]: new Date() } },
        order: [['scheduled_at', 'ASC']],
        limit: 25,
    });

    let fired = 0;
    for (const row of due) {
        /* eslint-disable no-await-in-loop */
        const [claimed] = await EventNotification.update(
            { status: 'sending' },
            { where: { id: row.id, status: 'scheduled' } },
        );
        if (!claimed) continue;
        fired += 1;
        try {
            const event = await Event.findByPk(row.event_id, { attributes: EVENT_ATTRS });
            if (!event) throw new Error('The event of this notification no longer exists.');
            await row.reload();
            const outcome = await deliver(row, event);
            // Not `logActivity`: that writes `activity_logs`, whose user_id is an
            // admin user — the scheduler has none.
            logger.info('Scheduled event notification sent', { id: row.id, ...outcome });
        } catch (err) {
            logger.logError(err);
            await EventNotification.update(
                { status: 'failed', failed_reason: String(err.message).slice(0, 255) },
                { where: { id: row.id } },
            );
        }
        /* eslint-enable no-await-in-loop */
    }
    return { fired };
};

module.exports = {
    MAX_IMAGE_BYTES,
    IMAGE_MIMES,
    list,
    getOne,
    create,
    update,
    reschedule,
    remove,
    audienceOptions,
    uploadImage,
    sendDue,
    // Exported for the tests — the time zone arithmetic is the part worth locking.
    instantOf,
    wallClock,
    offsetMinutes,
};
