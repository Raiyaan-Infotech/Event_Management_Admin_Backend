const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { Event } = require('../models');

/**
 * Organizer Contact - the contact card shown in the mobile app's
 * Contact / Organizer section (Edit Event -> Contact / Organizer).
 *
 * Fields stored on the event row itself:
 *   organizer        -> contact name
 *   organizer_image  -> photo URL
 *   contact_phone    -> mobile number (with dial code)
 *   contact_email    -> email address
 *   venue_address    -> address / location
 *   description      -> description / note
 *
 * Ownership is always enforced through website_client_id.
 */

const CONTACT_FIELDS = [
    'organizer',
    'organizer_image',
    'contact_phone',
    'contact_email',
    'venue_address',
    'description',
];

const MAX = {
    organizer: 200,
    organizer_image: 500,
    contact_phone: 30,
    contact_email: 150,
    venue_address: 500,
};

const trimOrNull = (v) =>
    v !== undefined && v !== null ? (String(v).trim() || null) : undefined;

/** Shape the event row into the contact payload the mobile app reads. */
const buildPayload = (event) => ({
    name:        event.organizer       ?? null,
    photo:       event.organizer_image ?? null,
    mobile:      event.contact_phone   ?? null,
    email:       event.contact_email   ?? null,
    address:     event.venue_address   ?? null,
    description: event.description     ?? null,
});

/**
 * GET /events/:id/organizer-contact
 * Returns the organizer contact fields for the caller's event.
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
        'Organizer contact retrieved',
    );
});

/**
 * PUT /events/:id/organizer-contact
 * Updates only the organizer contact fields. All body fields are optional.
 *
 * Body:
 *   name        (string) - organizer / contact full name
 *   photo       (string) - URL returned by the cover-image uploader
 *   mobile      (string) - phone number with dial code, e.g. "+880 1711 777888"
 *   email       (string) - email address
 *   address     (string) - office / contact address
 *   description (string) - description or note shown on the contact card
 */
const updateContact = asyncHandler(async (req, res) => {
    const event = await Event.findOne({
        where: {
            id: req.params.id,
            website_client_id: req.websiteClient.id,
        },
    });

    if (!event) throw ApiError.notFound('Event not found.');

    const body = req.body || {};
    const patch = {};

    if ('name' in body) {
        const v = trimOrNull(body.name);
        if (v && v.length > MAX.organizer) {
            throw ApiError.badRequest(`Name must be ${MAX.organizer} characters or fewer.`);
        }
        patch.organizer = v ?? null;
    }

    if ('photo' in body) {
        const v = trimOrNull(body.photo);
        if (v && v.length > MAX.organizer_image) {
            throw ApiError.badRequest('Photo URL is too long.');
        }
        patch.organizer_image = v ?? null;
    }

    if ('mobile' in body) {
        const v = trimOrNull(body.mobile);
        if (v && v.length > MAX.contact_phone) {
            throw ApiError.badRequest(`Mobile number must be ${MAX.contact_phone} characters or fewer.`);
        }
        patch.contact_phone = v ?? null;
    }

    if ('email' in body) {
        const v = trimOrNull(body.email);
        if (v && !v.includes('@')) {
            throw ApiError.badRequest('Please enter a valid email address.');
        }
        if (v && v.length > MAX.contact_email) {
            throw ApiError.badRequest(`Email must be ${MAX.contact_email} characters or fewer.`);
        }
        patch.contact_email = v ?? null;
    }

    if ('address' in body) {
        const v = trimOrNull(body.address);
        if (v && v.length > MAX.venue_address) {
            throw ApiError.badRequest(`Address must be ${MAX.venue_address} characters or fewer.`);
        }
        patch.venue_address = v ?? null;
    }

    if ('description' in body) {
        patch.description = trimOrNull(body.description) ?? null;
    }

    if (Object.keys(patch).length > 0) {
        await event.update(patch);
    }

    return ApiResponse.success(
        res,
        { contact: buildPayload(event) },
        Object.keys(patch).length > 0
            ? 'Organizer contact updated successfully'
            : 'No changes supplied',
    );
});

module.exports = { getContact, updateContact };