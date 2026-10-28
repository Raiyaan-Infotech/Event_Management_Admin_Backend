const { Event, EventParticipant, WebsiteClient, Guest, GuestGroup, GuestFoodPreferenceOption } = require('../models');
const ApiError = require('../utils/apiError');
const eventQr = require('../utils/eventQr');
const personQr = require('../utils/personQr');
const { relationOf } = require('./clientQrScan.service');

/**
 * ORGANIZER SCAN — Verify Participant / Mark Attendance (Jamal, 2026-10-28).
 *
 * The organizer (or contact person) picks an event, then scans a participant's
 * personal QR (their account QR — one per person). The routes are
 * `/events/:id/…`, so eventOrganizerAccess has already made an organizer or
 * contact person act as the event's owner: owning the event is the check.
 *
 *   Verify Participant  — any event; shows the details, WRITES NOTHING.
 *   Mark Attendance     — PRIVATE events only; records one check-in.
 */

/** The caller's event (as owner, after eventOrganizerAccess). */
const ownEvent = async (req, eventId) => {
    const event = await Event.findOne({
        where: { id: Number(eventId) || 0, website_client_id: req.websiteClient.id },
        attributes: ['id', 'name', 'start_date', 'privacy'],
    });
    if (!event) throw ApiError.notFound('Event not found.');
    return event;
};

/** "EVT2026-000123" — a readable participant id for the Verify screen. */
const participantCode = (p, event) =>
    `EVT${String(event.start_date || '').slice(0, 4) || new Date().getFullYear()}-${String(p.id).padStart(6, '0')}`;

const present = async (p, event, client) => {
    const [guest, food] = await Promise.all([
        p.guest_id
            ? Guest.findByPk(p.guest_id, {
                attributes: ['id'],
                include: [{ model: GuestGroup, as: 'group', attributes: ['name'], required: false }],
            })
            : null,
        p.food_preference_option_id
            ? GuestFoodPreferenceOption.findByPk(p.food_preference_option_id, { attributes: ['name'] })
            : null,
    ]);
    const name = [p.title, p.name].filter((v) => String(v || '').trim()).join(' ');
    return {
        id: p.id,
        participant_code: participantCode(p, event),
        name: name || client?.name || 'Participant',
        photo: p.photo || client?.avatar_url || null,
        dial_code: p.dial_code || client?.dial_code || '+91',
        mobile: p.mobile || client?.mobile || null,
        email: p.email || client?.email || null,
        rsvp_status: p.rsvp_status,
        response_type: p.response_type,
        relation: relationOf(p),
        family_group: guest?.group?.name || null,
        party_size: Number(p.party_size) || 1,
        table_number: p.table_number || null,
        meal: food?.name || p.dietary_preference || null,
        checked_in_at: p.checked_in_at,
        checked_in_by_name: p.checked_in_by_name,
        event: {
            id: event.id,
            name: event.name,
            start_date: event.start_date,
            is_private: event.privacy === 'private',
        },
    };
};

/**
 * POST /client/events/:id/scan/participant { token } — who the scanned
 * participant QR belongs to, in THIS event. Writes nothing.
 */
const lookup = async (req, eventId, rawToken) => {
    const event = await ownEvent(req, eventId);
    const token = String(rawToken || '').trim();
    if (!token) throw ApiError.badRequest('No QR code supplied.');

    const payload = eventQr.decrypt(token);
    if (payload && payload.eid) {
        throw ApiError.badRequest("This is an event QR code. Please scan the participant's QR code.");
    }
    const parsed = personQr.parse(token);
    if (!parsed) throw ApiError.badRequest('This QR code is not valid.');
    if (parsed.kind !== 'client') {
        throw ApiError.badRequest("This is a contact person's QR code. Please scan the participant's QR code.");
    }

    const client = await WebsiteClient.findOne({
        where: { qr_code: parsed.code },
        attributes: ['id', 'name', 'avatar_url', 'dial_code', 'mobile', 'email'],
    });
    if (!client) throw ApiError.badRequest('This QR code is not valid.');

    const p = await EventParticipant.findOne({
        where: { event_id: event.id, participant_client_id: client.id },
        order: [['id', 'DESC']],
    });
    if (!p) throw ApiError.notFound(`${client.name} is not a participant of this event.`);
    return present(p, event, client);
};

/**
 * POST /client/events/:id/participants/:pid/check-in — Mark Attendance.
 * Private events only. Checking in twice keeps the first time.
 */
const checkIn = async (req, eventId, participantId) => {
    const event = await ownEvent(req, eventId);
    if (event.privacy !== 'private') {
        throw ApiError.badRequest('Attendance is marked only for private events.');
    }
    const p = await EventParticipant.findOne({ where: { id: Number(participantId) || 0, event_id: event.id } });
    if (!p) throw ApiError.notFound('Participant not found.');

    const client = p.participant_client_id
        ? await WebsiteClient.findByPk(p.participant_client_id, {
            attributes: ['id', 'name', 'avatar_url', 'dial_code', 'mobile', 'email'],
        })
        : null;

    if (p.checked_in_at) {
        return { already: true, participant: await present(p, event, client) };
    }
    // Who marked it: the real caller (organizer / contact person), else the owner.
    const by = req.organizerClient || req.websiteClient;
    await p.update({
        checked_in_at: new Date(),
        checked_in_by_client_id: Number(by?.id) || null,
        checked_in_by_name: by?.name || null,
    });
    return { already: false, participant: await present(p, event, client) };
};

module.exports = { lookup, checkIn };
