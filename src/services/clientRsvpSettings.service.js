const { Event } = require('../models');
const ApiError = require('../utils/apiError');

/**
 * RSVP Settings — one event's RSVP form, as the organizer configured it
 * (the app's Edit Event → RSVP screen; Jamal, 2026-10-07).
 *
 * Stored as ONE JSON column, `events.rsvp_settings`. NULL = never configured,
 * which reads as the defaults below — every existing event keeps the form it
 * always had (three answers, a head count, special requests) and gains only
 * the deadline, which defaults to the event's own end date.
 *
 * ⚠ "Enable RSVP" here is the ORGANIZER's switch. It sits on top of — not in
 * place of — `rsvpEnabledFor` (the event carries the RSVP menu AND the plan
 * grants it). Both must be on for a guest to answer.
 */

const RESPONSE_OPTIONS = ['yes', 'no', 'maybe'];
const SIDES = ['groom', 'bride'];

const DEFAULTS = Object.freeze({
    enabled: true,
    response_options: RESPONSE_OPTIONS,
    deadline: null,
    allow_guest_count: true,
    allow_special_requests: true,
    allow_relationship: false,
});

const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const parse = (raw) => {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) || {}; } catch { return {}; }
    }
    return typeof raw === 'object' ? raw : {};
};

const bool = (value, fallback) => (value === undefined || value === null
    ? fallback
    : value === true || value === 1 || value === '1' || value === 'true');

/**
 * The settings as every reader should see them: defaults filled in, and the
 * deadline resolved — the organizer's own date, else the event's end date.
 * `deadline` is what was stored (null = follow the event); `effective_deadline`
 * is the day the form actually closes.
 */
const settingsOf = (event) => {
    const plain = event?.toJSON ? event.toJSON() : (event || {});
    const stored = parse(plain.rsvp_settings);

    const options = Array.isArray(stored.response_options)
        ? RESPONSE_OPTIONS.filter((o) => stored.response_options.includes(o))
        : [];

    const deadline = isDate(stored.deadline) ? stored.deadline : null;
    const endDate = isDate(plain.end_date) ? plain.end_date : null;

    return {
        enabled: bool(stored.enabled, DEFAULTS.enabled),
        response_options: options.length ? options : [...DEFAULTS.response_options],
        deadline,
        effective_deadline: deadline || endDate,
        allow_guest_count: bool(stored.allow_guest_count, DEFAULTS.allow_guest_count),
        allow_special_requests: bool(stored.allow_special_requests, DEFAULTS.allow_special_requests),
        allow_relationship: bool(stored.allow_relationship, DEFAULTS.allow_relationship),
    };
};

/** True once the last day to answer has gone by (the whole deadline day counts). */
const deadlinePassed = (settings, now = new Date()) => {
    if (!settings.effective_deadline) return false;
    return now.getTime() > new Date(`${settings.effective_deadline}T23:59:59.999`).getTime();
};

async function ownEvent(clientId, rawEventId) {
    const id = Number(rawEventId);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('Event not found.');
    const event = await Event.findOne({
        where: { id, website_client_id: clientId },
        attributes: ['id', 'start_date', 'end_date', 'rsvp_settings'],
    });
    if (!event) throw ApiError.notFound('Event not found.');
    return event;
}

const present = (event) => ({
    event_id: event.id,
    event_start_date: event.start_date,
    event_end_date: event.end_date,
    settings: settingsOf(event),
});

const get = async (clientId, eventId) => present(await ownEvent(clientId, eventId));

/**
 * Save the settings. Only what is sent changes; the rest keeps its value.
 *
 * ⚠ Deliberately NOT through `clientEvent.updateEvent`: that reissues the
 * event's QR code on every save, and changing an RSVP switch must not make a
 * printed invitation's code stop matching.
 */
const update = async (clientId, eventId, body = {}) => {
    const event = await ownEvent(clientId, eventId);
    const current = settingsOf(event);
    const next = {
        enabled: current.enabled,
        response_options: current.response_options,
        deadline: current.deadline,
        allow_guest_count: current.allow_guest_count,
        allow_special_requests: current.allow_special_requests,
        allow_relationship: current.allow_relationship,
    };

    for (const key of ['enabled', 'allow_guest_count', 'allow_special_requests', 'allow_relationship']) {
        if (body[key] !== undefined) next[key] = bool(body[key], next[key]);
    }

    if (body.response_options !== undefined) {
        const picked = Array.isArray(body.response_options)
            ? RESPONSE_OPTIONS.filter((o) => body.response_options.map(String).includes(o))
            : [];
        if (!picked.length) throw ApiError.badRequest('Keep at least one response option.');
        next.response_options = picked;
    }

    if (body.deadline !== undefined) {
        if (body.deadline === null || body.deadline === '') {
            next.deadline = null;
        } else {
            const value = String(body.deadline).slice(0, 10);
            if (!isDate(value) || Number.isNaN(new Date(`${value}T00:00:00`).getTime())) {
                throw ApiError.badRequest('Please choose a valid response deadline.');
            }
            // A response after the event is over is no use to anybody.
            if (isDate(event.end_date) && value > event.end_date) {
                throw ApiError.badRequest('The response deadline cannot be after the event ends.');
            }
            next.deadline = value;
        }
    }

    await event.update({ rsvp_settings: next });
    return present(event);
};

module.exports = {
    RESPONSE_OPTIONS, SIDES, DEFAULTS, settingsOf, deadlinePassed, get, update,
};
