const { Sequelize, Event, WebsiteClient } = require('../models');

const { Op, fn, col, where: sqlWhere } = Sequelize;

/**
 * An event's ORGANIZER as a person who can sign in (decided by Jamal,
 * 2026-10-13).
 *
 * The client who owns an event (`events.website_client_id`) names ONE
 * organizer for it: the name, photo and phone on the Organizer page
 * (`events.organizer`, `organizer_image`, `contact_phone`). The holder of that
 * phone number is to manage the event — everything except deleting it or
 * creating new ones, and never the owner's billing.
 *
 * `events.organizer_client_id` is the link: the `website_clients` account that
 * number belongs to. It is kept by this file, never typed by anybody:
 *
 *   - when the organizer's number is saved on an event  → [syncEvent]
 *   - when that number signs in                         → [claimForClient]
 *   - when it signs in for the first time and has no account yet
 *                                                       → [createFromEvent]
 *
 * NULL = nobody but the owner. An event whose organizer number is the owner's
 * own stays NULL: the owner already has every right.
 *
 * This file only MAKES the link. What the linked account may then do is
 * `middleware/eventOrganizerAccess.js`: requests about an event they organise
 * run as its owner.
 */

/** The access middleware caches who organises what for a minute. */
const forgetAccess = () => require('../middleware/eventOrganizerAccess').forget();

/** The national number (last 10 digits) of whatever was typed; null if none. */
const nationalOf = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits.length >= 7 ? digits.slice(-10) : null;
};

/** "+91" from "+91 98846 99435"; India when no country code was typed. */
const dialOf = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits.length > 10 ? `+${digits.slice(0, -10)}` : '+91';
};

/**
 * Events whose organizer number is [national], inside one tenant.
 *
 * `contact_phone` is free text ("+91 98846 99435", "098846-99435"), so the
 * spaces and dashes are stripped in SQL before the suffix is compared. The
 * owner is joined for the tenant: an account of one vendor must never be
 * handed an event of another because two people share a number.
 */
const eventsForNumber = async (national, vendorId) => {
    if (!national) return [];
    const rows = await Event.findAll({
        where: sqlWhere(
            fn('REPLACE', fn('REPLACE', col('contact_phone'), ' ', ''), '-', ''),
            { [Op.like]: `%${national}` },
        ),
        attributes: [
            'id', 'website_client_id', 'company_id', 'organizer', 'organizer_image',
            'contact_phone', 'organizer_client_id',
        ],
        order: [['id', 'DESC']],
    });
    if (!rows.length) return [];

    const owners = await WebsiteClient.unscoped().findAll({
        where: { id: [...new Set(rows.map((e) => e.website_client_id))] },
        attributes: ['id', 'vendor_id'],
        raw: true,
    });
    const tenantOf = new Map(owners.map((o) => [Number(o.id), Number(o.vendor_id)]));
    return rows.filter((e) => tenantOf.get(Number(e.website_client_id)) === Number(vendorId));
};

/**
 * ── CONTACT PERSON = THE EVENT'S CONTACT (Jamal, 2026-10-26) ─────────────
 * One event has one contact person, kept ON THE EVENT (organizer,
 * contact_phone, contact_*). They are not clients: no website_clients row is
 * made for them (the accounts the 2026-10-13 version created were removed by
 * tools/apply-contact-person-logins.js). Who runs which event is read from the
 * event's contact mobile each time — `events.organizer_client_id` is no longer
 * written or read. A number that IS a client (or a participant) signs in as
 * itself and also gets the events it is the contact of.
 */

/* ── Presence: "Online" in the chat = active in the app lately ───────────── */

const ONLINE_MS = 3 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const touched = new Map();

/**
 * Remember that [mobile] used the app just now (one write a minute at most).
 * Kept per number in contact_person_logins — a contact person has no client
 * row. Never throws: presence must not break a request.
 */
const touchPresence = (mobile, vendorId) => {
    const national = nationalOf(mobile);
    if (!national || !vendorId) return;
    const key = `${vendorId}:${national}`;
    const last = touched.get(key) || 0;
    if (Date.now() - last < TOUCH_EVERY_MS) return;
    touched.set(key, Date.now());
    const { ContactPersonLogin } = require('../models');
    ContactPersonLogin.findOrCreate({
        where: { vendor_id: vendorId, mobile: national },
        defaults: { vendor_id: vendorId, mobile: national },
    })
        .then(([row]) => row.update({ last_seen_at: new Date() }))
        .catch(() => null);
};

/** Whether [mobile] used the app in the last few minutes. */
const isOnline = async (mobile, vendorId) => {
    const national = nationalOf(mobile);
    if (!national || !vendorId) return false;
    const { ContactPersonLogin } = require('../models');
    const row = await ContactPersonLogin.findOne({
        where: { vendor_id: vendorId, mobile: national },
        attributes: ['last_seen_at'],
        raw: true,
    });
    return Boolean(row?.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < ONLINE_MS);
};

/** An event's contact number changed: drop the cached "who runs what". */
const syncEvent = async (event) => {
    if (event) forgetAccess();
    return null;
};

/** How many events [client]'s number is the contact person of (not their own). */
const claimForClient = async (client) => {
    if (!client) return 0;
    const events = await eventsForNumber(nationalOf(client.mobile), client.vendor_id);
    return events.filter((e) => Number(e.website_client_id) !== Number(client.id)).length;
};

/**
 * The contact person behind a number with NO account: who they are, taken
 * from the newest event that names them. Null when no event has the number.
 */
const contactPersonFor = async (mobile, vendorId) => {
    const national = nationalOf(mobile);
    const events = await eventsForNumber(national, vendorId);
    if (!events.length) return null;
    const newest = events[0];
    return {
        mobile: national,
        dialCode: dialOf(newest.contact_phone),
        vendorId: Number(vendorId),
        companyId: newest.company_id ?? null,
        name: String(newest.organizer || '').trim() || 'Contact Person',
        photo: newest.organizer_image || null,
        events: events.length,
    };
};

/**
 * The stand-in for `req.websiteClient` when a contact person (no account) is
 * signed in: id 0, so everything that is the CALLER's own (billing, phone
 * book, their own events) is empty, and their events come through
 * eventOrganizerAccess by the number. `toJSON()` is what /me returns.
 */
const contactPersonCaller = (cp) => {
    const plain = {
        id: 0,
        name: cp.name,
        email: null,
        dial_code: cp.dialCode || '+91',
        mobile: cp.mobile,
        avatar_url: cp.photo || null,
        vendor_id: cp.vendorId,
        company_id: cp.companyId ?? null,
        subscription_plan_id: null,
        plan: null,
        is_active: 1,
        is_contact_person: true,
    };
    return { ...plain, toJSON: () => ({ ...plain }), get: () => ({ ...plain }) };
};

module.exports = {
    syncEvent,
    claimForClient,
    contactPersonFor,
    contactPersonCaller,
    touchPresence,
    isOnline,
    // Exported for the tests.
    nationalOf,
    dialOf,
    eventsForNumber,
};
