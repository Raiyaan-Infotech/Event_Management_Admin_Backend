const { Event, EventParticipant, WebsiteClient } = require('../models');
const ApiError = require('../utils/apiError');
const { Op } = require('sequelize');

/**
 * Participant Settings — one event's participant list & profile display config
 * (the app's Edit Event → Participants screen; Jamal, 2026-10-07 / 2026-10-08).
 *
 * Stored as ONE JSON column, `events.participant_settings`. NULL = never configured,
 * which reads as all defaults (everything enabled).
 */

const DEFAULTS = Object.freeze({
    profile_screen: true,
    profile_photo: true,
    name: true,
    relationship: true,
    attendance_status: true,
});

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
 * Return resolved participant settings for an event.
 */
const settingsOf = (event) => {
    const plain = event?.toJSON ? event.toJSON() : (event || {});
    const stored = parse(plain.participant_settings);

    return {
        profile_screen: bool(stored.profile_screen, DEFAULTS.profile_screen),
        profile_photo: bool(stored.profile_photo, DEFAULTS.profile_photo),
        name: true, // Always true — a row without a name cannot be identified
        relationship: bool(stored.relationship, DEFAULTS.relationship),
        attendance_status: bool(stored.attendance_status, DEFAULTS.attendance_status),
    };
};

async function ownEvent(clientId, rawEventId) {
    const id = Number(rawEventId);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('Event not found.');
    const event = await Event.findOne({
        where: { id, website_client_id: clientId },
        attributes: ['id', 'website_client_id', 'participant_settings'],
    });
    if (!event) throw ApiError.notFound('Event not found.');
    return event;
}

/**
 * Get participant settings. Accessible by event owner OR any registered participant.
 */
const get = async (clientId, rawEventId) => {
    const id = Number(rawEventId);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('Event not found.');

    const event = await Event.findByPk(id, {
        attributes: ['id', 'website_client_id', 'participant_settings'],
    });
    if (!event) throw ApiError.notFound('Event not found.');

    const isOwner = Number(event.website_client_id) === Number(clientId);
    if (!isOwner) {
        // Verify caller is a participant of this event
        const client = await WebsiteClient.findByPk(clientId, { attributes: ['id', 'mobile'] });
        const clientDigits = client?.mobile ? String(client.mobile).replace(/\D/g, '') : '';
        const mobileCandidates = clientDigits
            ? [...new Set([client?.mobile, clientDigits, clientDigits.slice(-10)])].filter(Boolean)
            : (client?.mobile ? [client.mobile] : []);

        const participantCondition = mobileCandidates.length > 0
            ? {
                event_id: id,
                [Op.or]: [
                    { participant_client_id: clientId },
                    { mobile: { [Op.in]: mobileCandidates } },
                ],
            }
            : { event_id: id, participant_client_id: clientId };

        const participant = await EventParticipant.findOne({ where: participantCondition, attributes: ['id'] });
        if (!participant) {
            throw ApiError.notFound('You are not a participant of this event.');
        }
    }

    return {
        event_id: event.id,
        settings: settingsOf(event),
    };
};

/**
 * Save participant settings — owner only.
 */
const update = async (clientId, rawEventId, body = {}) => {
    const event = await ownEvent(clientId, rawEventId);
    const current = settingsOf(event);

    const next = {
        profile_screen: bool(body.profile_screen, current.profile_screen),
        profile_photo: bool(body.profile_photo, current.profile_photo),
        name: true,
        relationship: bool(body.relationship, current.relationship),
        attendance_status: bool(body.attendance_status, current.attendance_status),
    };

    await event.update({ participant_settings: next });

    return {
        event_id: event.id,
        settings: next,
    };
};

module.exports = {
    DEFAULTS,
    settingsOf,
    get,
    update,
};
