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
 * After an event's organizer number changed: point it at the account that
 * number belongs to, or at nobody. Creates no account — a number that has
 * never signed in is linked when it first does.
 */
const syncEvent = async (event) => {
    if (!event) return null;
    const national = nationalOf(event.contact_phone);
    let organizerId = null;

    if (national) {
        const owner = await WebsiteClient.unscoped().findByPk(event.website_client_id, {
            attributes: ['id', 'vendor_id'],
        });
        const account = owner && await WebsiteClient.unscoped().findOne({
            where: { vendor_id: owner.vendor_id, mobile: national },
            attributes: ['id'],
        });
        if (account && Number(account.id) !== Number(event.website_client_id)) {
            organizerId = Number(account.id);
        }
    }

    // Written every time, not only when the instance in hand looks different:
    // that instance may be stale, and a link left behind is somebody keeping
    // control of an event after their number was taken off it.
    await Event.update({ organizer_client_id: organizerId }, { where: { id: event.id } });
    forgetAccess();
    return organizerId;
};

/**
 * When an account signs in: every event whose organizer number is theirs
 * becomes theirs to manage. One UPDATE. Returns how many events they organise.
 */
const claimForClient = async (client) => {
    if (!client) return 0;
    const events = await eventsForNumber(nationalOf(client.mobile), client.vendor_id);
    const mine = events.filter((e) => Number(e.website_client_id) !== Number(client.id));
    const unlinked = mine.filter((e) => Number(e.organizer_client_id) !== Number(client.id));
    if (unlinked.length) {
        await Event.update(
            { organizer_client_id: client.id },
            { where: { id: unlinked.map((e) => e.id) } },
        );
        forgetAccess();
    }
    return mine.length;
};

/**
 * A number with no account that IS some event's organizer number: give it one,
 * so it can sign in. Named after the organizer the owner typed. Null when no
 * event has that number — the caller then answers "not registered".
 */
const createFromEvent = async (mobile, vendorId) => {
    const national = nationalOf(mobile);
    const events = await eventsForNumber(national, vendorId);
    if (!events.length) return null;

    const newest = events[0];
    return WebsiteClient.create({
        name: String(newest.organizer || '').trim() || 'Organizer',
        dial_code: dialOf(newest.contact_phone),
        mobile: national,
        vendor_id: vendorId,
        company_id: newest.company_id ?? null,
        source: 'website',
        is_active: 1,
        avatar_url: newest.organizer_image || null,
    });
};

/** How many events this account organises (not counting the ones it owns). */
const countOrganised = (clientId) =>
    Event.count({ where: { organizer_client_id: clientId } });

module.exports = {
    syncEvent,
    claimForClient,
    createFromEvent,
    countOrganised,
    // Exported for the tests.
    nationalOf,
    dialOf,
    eventsForNumber,
};
