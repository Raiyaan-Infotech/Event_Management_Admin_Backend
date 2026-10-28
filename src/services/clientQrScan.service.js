const { Sequelize, Event, EventParticipant, WebsiteClient, ContactPersonLogin, ClientQrContact } = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const eventQr = require('../utils/eventQr');
const personQr = require('../utils/personQr');
const organizer = require('./eventOrganizer.service');

/**
 * SCAN QR + MY FAVOURITES (Jamal, 2026-10-28).
 *
 * One scan endpoint tells what a code is: an EVENT QR (the app carries on
 * with its join / open-event flow) or a PERSON QR — an account (host or
 * participant: one QR per person, the same in every event) or a contact
 * person. A person is shown only when the scanner and they share an event
 * (same event only, for now), and only minimal contact details.
 *
 * Every person scan by an account is remembered in `client_qr_contacts`
 * ("My Scans"); Save to Favourites flags the row ("Contacts"). A contact
 * person (no account) can scan but has no Favourites.
 */

const SIDE = { bride: "Bride's", groom: "Groom's" };

/** "Bride's Friend", "Friend", "Bride's Side" — or null. */
const relationOf = (p) => {
    const rel = String(p?.relationship || '').trim();
    const side = SIDE[p?.rsvp_side];
    if (side && rel) return `${side} ${rel}`;
    if (rel) return rel;
    return side ? `${side} Side` : null;
};

/** Ids of the events an ACCOUNT is in: owns, organises, or joined. */
const accountEventIds = async (clientId) => {
    const [owned, joined] = await Promise.all([
        Event.findAll({
            where: { [Op.or]: [{ website_client_id: clientId }, { organizer_client_id: clientId }] },
            attributes: ['id'],
            raw: true,
        }),
        EventParticipant.findAll({
            where: { participant_client_id: clientId, event_id: { [Op.ne]: null } },
            attributes: ['event_id'],
            raw: true,
        }),
    ]);
    return new Set([...owned.map((e) => e.id), ...joined.map((p) => p.event_id)]);
};

/** Ids of the events a CONTACT PERSON is the contact of. */
const contactEventIds = async (mobile, vendorId) =>
    new Set((await organizer.eventsForNumber(organizer.nationalOf(mobile), vendorId)).map((e) => e.id));

/** The caller's events — an account, or a signed-in contact person. */
const callerEventIds = (req) => (req.contactPerson
    ? contactEventIds(req.contactPerson.mobile, req.contactPerson.vendorId)
    : accountEventIds(req.websiteClient.id));

/** The newest event both share, or a refusal. */
const sharedEvent = async (mine, theirs) => {
    const common = [...theirs].filter((id) => mine.has(id));
    if (!common.length) throw ApiError.forbidden("This person isn't in your event.");
    return Event.findOne({
        where: { id: { [Op.in]: common } },
        order: [['start_date', 'DESC'], ['id', 'DESC']],
        attributes: ['id', 'name', 'start_date', 'website_client_id', 'organizer', 'organizer_image', 'contact_phone', 'contact_email'],
    });
};

/** A scanned ACCOUNT → minimal details in the event both share. */
const resolveAccount = async (req, code) => {
    const person = await WebsiteClient.findOne({
        where: { qr_code: code },
        attributes: ['id', 'name', 'avatar_url', 'dial_code', 'mobile', 'email', 'vendor_id'],
    });
    if (!person) throw ApiError.badRequest('This QR code is not valid.');
    if (!req.contactPerson && person.id === req.websiteClient.id) {
        throw ApiError.badRequest('This is your own QR code.');
    }
    const event = await sharedEvent(await callerEventIds(req), await accountEventIds(person.id));
    const isHost = Number(event.website_client_id) === Number(person.id);
    const part = isHost ? null : await EventParticipant.findOne({
        where: { event_id: event.id, participant_client_id: person.id },
        attributes: ['relationship', 'rsvp_side', 'photo'],
        order: [['id', 'DESC']],
    });
    return {
        person_kind: 'client',
        person_id: person.id,
        role: isHost ? 'host' : 'participant',
        name: person.name,
        photo: person.avatar_url || part?.photo || null,
        dial_code: person.dial_code || '+91',
        mobile: person.mobile || null,
        email: person.email || null,
        relation: isHost ? 'Host' : relationOf(part),
        event,
    };
};

/** A scanned CONTACT PERSON → their details from the event both share. */
const resolveContactPerson = async (req, code) => {
    const cp = await ContactPersonLogin.findOne({ where: { qr_code: code }, attributes: ['id', 'vendor_id', 'mobile'] });
    if (!cp) throw ApiError.badRequest('This QR code is not valid.');
    if (req.contactPerson && organizer.nationalOf(req.contactPerson.mobile) === cp.mobile) {
        throw ApiError.badRequest('This is your own QR code.');
    }
    const event = await sharedEvent(await callerEventIds(req), await contactEventIds(cp.mobile, cp.vendor_id));
    return {
        person_kind: 'contact_person',
        person_id: cp.id,
        role: 'contact_person',
        name: String(event.organizer || '').trim() || 'Contact Person',
        photo: event.organizer_image || null,
        dial_code: organizer.dialOf(event.contact_phone),
        mobile: cp.mobile,
        email: event.contact_email || null,
        relation: 'Contact Person',
        event,
    };
};

/** Remember the scan ("My Scans"); returns the row. Accounts only. */
const remember = async (ownerId, d) => {
    const snapshot = {
        event_id: d.event.id,
        role: d.role,
        name: d.name,
        photo: d.photo,
        dial_code: d.dial_code,
        mobile: d.mobile,
        email: d.email,
        relation: d.relation,
        event_name: d.event.name,
        event_date: d.event.start_date || null,
        last_scanned_at: new Date(),
    };
    const [row, created] = await ClientQrContact.findOrCreate({
        where: { owner_client_id: ownerId, person_kind: d.person_kind, person_id: d.person_id },
        defaults: { ...snapshot, owner_client_id: ownerId, person_kind: d.person_kind, person_id: d.person_id },
    });
    if (!created) await row.update({ ...snapshot, scan_count: row.scan_count + 1 });
    return row;
};

/** An event QR scan, for My Scans' "Event QR" group. */
const rememberEvent = async (ownerId, eventId) => {
    const event = await Event.findByPk(eventId, { attributes: ['id', 'name', 'start_date', 'venue_name'] });
    if (!event) return null;
    return remember(ownerId, {
        person_kind: 'event',
        person_id: event.id,
        role: 'event',
        name: event.name,
        photo: null,
        dial_code: null,
        mobile: null,
        email: null,
        relation: event.venue_name || null,
        event,
    });
};

const presentContact = (row) => {
    const r = row.toJSON ? row.toJSON() : row;
    return {
        id: r.id,
        person_kind: r.person_kind,
        person_id: r.person_id,
        role: r.role,
        name: r.name,
        photo: r.photo,
        dial_code: r.dial_code,
        mobile: r.mobile,
        email: r.email,
        relation: r.relation,
        event_id: r.event_id,
        event_name: r.event_name,
        event_date: r.event_date,
        is_favourite: Boolean(r.is_favourite),
        last_scanned_at: r.last_scanned_at,
    };
};

/**
 * POST /client/qr/scan — what a scanned code is.
 *   { type: 'event' }                        the app runs its event flow
 *   { type: 'person', contact: {...} }       minimal details (+ saved state)
 */
const scan = async (req, rawToken) => {
    const token = String(rawToken || '').trim();
    if (!token) throw ApiError.badRequest('No QR code supplied.');

    const payload = eventQr.decrypt(token);
    if (payload && payload.eid) {
        // Remembered in My Scans ("Event QR") for an account; the app then
        // runs its own join / open-event flow.
        if (!req.contactPerson) await rememberEvent(req.websiteClient.id, payload.eid).catch(() => null);
        return { type: 'event', event_id: payload.eid };
    }

    const parsed = personQr.parse(token);
    if (!parsed) throw ApiError.badRequest('This QR code is not valid.');

    const details = parsed.kind === 'contact_person'
        ? await resolveContactPerson(req, parsed.code)
        : await resolveAccount(req, parsed.code);

    if (req.contactPerson) {
        // No account → nothing to remember; the details are still shown.
        const { event, ...rest } = details;
        return {
            type: 'person',
            contact: { id: null, ...rest, event_id: event.id, event_name: event.name, event_date: event.start_date, is_favourite: false },
            can_save: false,
        };
    }
    const row = await remember(req.websiteClient.id, details);
    return { type: 'person', contact: presentContact(row), can_save: true };
};

/** GET /client/me/qr — the caller's own QR. */
const myQr = async (req) => {
    if (req.contactPerson) {
        const mobile = organizer.nationalOf(req.contactPerson.mobile);
        const [row] = await ContactPersonLogin.findOrCreate({
            where: { vendor_id: req.contactPerson.vendorId, mobile },
            defaults: { vendor_id: req.contactPerson.vendorId, mobile },
        });
        if (!row.qr_token) {
            personQr.stamp(row, 'contact_person');
            await row.save({ fields: ['qr_code', 'qr_token'] });
        }
        return { kind: 'contact_person', qr_token: row.qr_token, name: req.contactPerson.name || null };
    }
    const client = await WebsiteClient.findByPk(req.websiteClient.id, { attributes: ['id', 'name', 'avatar_url', 'qr_code', 'qr_token'] });
    if (!client) throw ApiError.notFound('Account not found.');
    if (!client.qr_token) {
        personQr.stamp(client, 'client');
        await client.save({ fields: ['qr_code', 'qr_token'] });
    }
    return { kind: 'client', qr_token: client.qr_token, name: client.name, photo: client.avatar_url || null };
};

const ownerOf = (req) => {
    if (req.contactPerson) throw ApiError.forbidden('My Favourites needs an account.');
    return req.websiteClient.id;
};

/** GET /client/favourites?tab=contacts|scans&search= */
const listFavourites = async (req, query = {}) => {
    const owner = ownerOf(req);
    const tab = query.tab === 'scans' ? 'scans' : 'contacts';
    const where = { owner_client_id: owner };
    if (tab === 'contacts') {
        where.is_favourite = true;
        where.person_kind = { [Op.ne]: 'event' };
    }
    const search = String(query.search || '').trim();
    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { mobile: { [Op.like]: `%${search}%` } },
            { relation: { [Op.like]: `%${search}%` } },
            { event_name: { [Op.like]: `%${search}%` } },
        ];
    }
    const rows = await ClientQrContact.findAll({
        where,
        order: tab === 'contacts'
            ? [['favourited_at', 'DESC'], ['id', 'DESC']]
            : [['last_scanned_at', 'DESC'], ['id', 'DESC']],
        limit: 500,
    });
    const [contacts, scans] = await Promise.all([
        ClientQrContact.count({ where: { owner_client_id: owner, is_favourite: true } }),
        ClientQrContact.count({ where: { owner_client_id: owner } }),
    ]);
    return { tab, rows: rows.map(presentContact), counts: { contacts, scans } };
};

/** PUT /client/favourites/:id { favourite } — Save to / remove from Favourites. */
const setFavourite = async (req, id, favourite) => {
    const owner = ownerOf(req);
    const row = await ClientQrContact.findOne({ where: { id: Number(id) || 0, owner_client_id: owner } });
    if (!row) throw ApiError.notFound('Contact not found.');
    if (row.person_kind === 'event') throw ApiError.badRequest('Only people can be saved to Favourites.');
    const on = favourite === true || favourite === 'true' || favourite === 1 || favourite === '1';
    await row.update({ is_favourite: on, favourited_at: on ? (row.favourited_at || new Date()) : null });
    return presentContact(row);
};

module.exports = { scan, myQr, listFavourites, setFavourite, relationOf };
