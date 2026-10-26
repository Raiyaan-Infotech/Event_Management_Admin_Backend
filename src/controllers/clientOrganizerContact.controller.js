const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { Event } = require('../models');
const mediaService = require('../services/media.service');
const eventOrganizer = require('../services/eventOrganizer.service');

/**
 * Contact Person - the event's contact card (mobile app: Contact Person
 * Profile / Edit Contact, Jamal's design 2026-10-26).
 *
 * Fields on the event row:
 *   organizer                -> name
 *   organizer_image          -> photo URL
 *   contact_phone            -> mobile (with dial code) — also decides who may
 *                               manage the event (eventOrganizer.syncEvent)
 *   contact_email            -> email
 *   contact_designation      -> designation / role
 *   contact_whatsapp         -> WhatsApp number (with dial code)
 *   contact_address          -> address / base location
 *   contact_time_from / _to  -> preferred contact time, 'HH:MM' 24h
 *   contact_languages        -> ["Tamil", "English"]
 *   contact_about            -> about the contact person (300 max)
 *   (Responsibilities are fixed in the app — not stored.)
 *
 * Until 2026-10-26 "address" was written to venue_address and "description"
 * to the event description, overwriting the venue and the event text. Both now
 * have their own columns; an old app still sending `description` lands in
 * contact_about.
 *
 * Ownership is always enforced through website_client_id.
 */

const CONTACT_FIELDS = [
    'organizer',
    'organizer_image',
    'contact_phone',
    'contact_email',
    'contact_designation',
    'contact_whatsapp',
    'contact_address',
    'contact_time_from',
    'contact_time_to',
    'contact_languages',
    'contact_about',
];

/** body key -> column, max length. */
const TEXT = {
    name:        ['organizer', 200, 'Name'],
    photo:       ['organizer_image', 500, 'Photo URL'],
    mobile:      ['contact_phone', 30, 'Mobile number'],
    email:       ['contact_email', 150, 'Email'],
    designation: ['contact_designation', 100, 'Designation'],
    whatsapp:    ['contact_whatsapp', 30, 'WhatsApp number'],
    address:     ['contact_address', 500, 'Address'],
    about:       ['contact_about', 300, 'About'],
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const trimOrNull = (v) =>
    v !== undefined && v !== null ? (String(v).trim() || null) : undefined;

const list = (v) => (Array.isArray(v) ? v : []);

/** Shape the event row into the contact payload the mobile app reads. */
const buildPayload = (event) => ({
    name:             event.organizer ?? null,
    photo:            event.organizer_image ?? null,
    mobile:           event.contact_phone ?? null,
    email:            event.contact_email ?? null,
    designation:      event.contact_designation ?? null,
    whatsapp:         event.contact_whatsapp ?? null,
    address:          event.contact_address ?? null,
    time_from:        event.contact_time_from ?? null,
    time_to:          event.contact_time_to ?? null,
    languages:        list(event.contact_languages),
    about:            event.contact_about ?? null,
    // Old name of `about` — the client web portal's form still reads it.
    description:      event.contact_about ?? null,
});

/**
 * GET /events/:id/organizer-contact
 * Returns the contact person fields for the caller's event.
 */
const getContact = asyncHandler(async (req, res) => {
    const event = await Event.findOne({
        where: {
            id: req.params.id,
            website_client_id: req.websiteClient.id,
        },
        attributes: ['id', ...CONTACT_FIELDS],
    });

    if (!event) throw ApiError.notFound('Event not found.');

    return ApiResponse.success(
        res,
        { contact: buildPayload(event) },
        'Contact person retrieved',
    );
});

/**
 * PUT /events/:id/organizer-contact
 * Updates only the contact person fields. Every field is optional; a key sent
 * as null / '' clears it.
 *
 * Body: name, photo, mobile, email, designation, whatsapp, address, about
 * (strings); time_from, time_to ('HH:MM'); languages (string[]).
 * `description` = old name of about.
 */
const updateContact = asyncHandler(async (req, res) => {
    const event = await Event.findOne({
        where: {
            id: req.params.id,
            website_client_id: req.websiteClient.id,
        },
    });

    if (!event) throw ApiError.notFound('Event not found.');

    const body = { ...(req.body || {}) };
    if ('description' in body && !('about' in body)) body.about = body.description;
    const patch = {};

    for (const [key, [column, max, label]] of Object.entries(TEXT)) {
        if (!(key in body)) continue;
        const v = trimOrNull(body[key]);
        if (v && v.length > max) {
            throw ApiError.badRequest(`${label} must be ${max} characters or fewer.`);
        }
        patch[column] = v ?? null;
    }
    if (patch.contact_email && !patch.contact_email.includes('@')) {
        throw ApiError.badRequest('Please enter a valid email address.');
    }

    for (const [key, column] of [['time_from', 'contact_time_from'], ['time_to', 'contact_time_to']]) {
        if (!(key in body)) continue;
        const v = trimOrNull(body[key]);
        if (v && !TIME_RE.test(v)) {
            throw ApiError.badRequest('Please choose a valid preferred contact time.');
        }
        patch[column] = v ?? null;
    }

    if ('languages' in body) {
        const langs = [...new Set(list(body.languages)
            .map((l) => String(l ?? '').trim())
            .filter(Boolean))];
        if (langs.length > 10 || langs.some((l) => l.length > 40)) {
            throw ApiError.badRequest('Please choose up to 10 languages.');
        }
        patch.contact_languages = langs.length ? langs : null;
    }

    if (Object.keys(patch).length > 0) {
        await event.update(patch);
    }
    // The contact's number decides who else may manage the event.
    if ('contact_phone' in patch) await eventOrganizer.syncEvent(event);

    return ApiResponse.success(
        res,
        { contact: buildPayload(event) },
        Object.keys(patch).length > 0
            ? 'Contact details updated successfully'
            : 'No changes supplied',
    );
});

/**
 * POST /events/organizer-photo
 * Stores a contact photo (images only, 4MB — filtered by the route) and returns
 * its URL, which the app then sends as `photo` on the PUT above.
 *
 * Its own endpoint and its own folder, so contact photos are not mixed in with
 * event cover images.
 */
const uploadPhoto = asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose an image to upload.');
    const stored = await mediaService.upload(
        file,
        { folder: `organizer-contacts/${req.websiteClient.id}` },
        req.websiteClient.company_id || 1,
    );
    if (!stored || !stored.url) throw ApiError.badRequest('That image could not be stored.');
    return ApiResponse.success(res, { url: stored.url }, 'Photo uploaded');
});

module.exports = { getContact, updateContact, uploadPhoto };