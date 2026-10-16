const {
    Event, WebsiteClient, EventAgendaItem, EventNotification, EventFamilyMember,
    EventGalleryItem, EventGalleryCategory, EventParticipant, EventWish,
} = require('../models');

/**
 * Lets an event's ORGANIZER manage it (Jamal, 2026-10-13).
 *
 * An event has one owner (`website_client_id`, the client) and may have one
 * organizer (`organizer_client_id` — see eventOrganizer.service). The
 * organizer has full control of THAT event, except deleting it; they create no
 * events, and the owner's billing, plan and guest phone book stay the owner's.
 *
 * ── HOW, AND WHY NOT IN EVERY SERVICE ───────────────────────────────────────
 * The services ask "is the caller this event's owner?" in about 180 places,
 * and every row they write carries the owner's id. Rather than teach each of
 * them a second kind of caller, this runs once, after authentication:
 *
 *   when the request is about an event the caller ORGANISES, it continues as
 *   that event's OWNER (`req.websiteClient` = the owner), with the real caller
 *   kept on `req.organizerClient`.
 *
 * So the organizer sees and writes exactly what the owner would — the owner's
 * plan limits apply, new rows belong to the owner — and no service changed.
 *
 * ── THE REQUEST MUST NAME THE EVENT ─────────────────────────────────────────
 * Acting as the owner is only safe while it is pinned to ONE event: the owner
 * has other events the organizer has no business in. So the swap happens only
 * when the event can be read off the request itself —
 *   /events/:id/…                       the id in the path
 *   /agenda/:id, /gallery/:id, …        the row is looked up for ITS event
 *   /participants, /rsvps (?event_id=)  the id in the query or the body
 * — and that event is one the caller organises. Anything else runs as the
 * caller themselves, who owns nothing and so gets nothing: the events list,
 * billing, settings, the guest phone book, a list call without an event id.
 *
 * ⚠ Adding a route that works on an event's data? If its path is not one of
 * the shapes above, the organizer is locked out of it (safe, but a bug): add
 * it to [ITEM_ROUTES] / [QUERY_ROUTES].
 */

const TTL_MS = 60 * 1000;

/** clientId -> { at, events: Map(eventId -> ownerId) }. Empty for most callers. */
const organisedCache = new Map();
/** ownerId -> { at, client }. */
const ownerCache = new Map();

/** Called when a link changes, so a new organizer is not kept out for a minute. */
const forget = () => {
    organisedCache.clear();
    ownerCache.clear();
};

/** The events [clientId] organises (and does not own), as eventId -> ownerId. */
const organisedBy = async (clientId) => {
    const hit = organisedCache.get(clientId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.events;

    const rows = await Event.findAll({
        where: { organizer_client_id: clientId },
        attributes: ['id', 'website_client_id'],
        raw: true,
    });
    const events = new Map(
        rows
            .filter((r) => Number(r.website_client_id) !== Number(clientId))
            .map((r) => [Number(r.id), Number(r.website_client_id)]),
    );
    organisedCache.set(clientId, { at: Date.now(), events });
    return events;
};

const ownerOf = async (ownerId) => {
    const hit = ownerCache.get(ownerId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.client;
    const client = await WebsiteClient.findByPk(ownerId);
    if (client) ownerCache.set(ownerId, { at: Date.now(), client });
    return client;
};

/** Paths that are one row of an event's data: the row says which event. */
const ITEM_ROUTES = [
    [/^\/agenda\/(\d+)/, EventAgendaItem],
    [/^\/event-notifications\/(\d+)/, EventNotification],
    [/^\/family-members\/(\d+)/, EventFamilyMember],
    [/^\/wishes\/(\d+)/, EventWish],
    [/^\/gallery\/categories\/(\d+)/, EventGalleryCategory],
    [/^\/gallery\/(\d+)/, EventGalleryItem],
    [/^\/participants\/(\d+)/, EventParticipant],
    // An RSVP is a participant row.
    [/^\/rsvps\/(\d+)/, EventParticipant],
];

/** List / stats calls that take the event as `event_id`. */
const QUERY_ROUTES = /^\/(participants|rsvps)(\/(stats|capacity|export))?\/?$/;

const EVENT_PATH = /^\/events\/(\d+)(\/.*)?$/;
/** Under /events/:id but the CALLER's own, not the event's. */
const PERSONAL = /^\/events\/\d+\/wishlist\/?$/;
const SPLASH_FOR_EVENT = /^\/splash-screens\/for-event\/(\d+)/;

/** The event a request is about, when the request itself says so. */
const targetEvent = async (req, organised) => {
    const path = req.path;

    const direct = EVENT_PATH.exec(path) || SPLASH_FOR_EVENT.exec(path);
    if (direct) return PERSONAL.test(path) ? null : Number(direct[1]);

    for (const [pattern, Model] of ITEM_ROUTES) {
        const m = pattern.exec(path);
        if (m) {
            // eslint-disable-next-line no-await-in-loop
            const row = await Model.findByPk(Number(m[1]), { attributes: ['event_id'] });
            return row ? Number(row.event_id) : null;
        }
    }

    if (QUERY_ROUTES.test(path)) {
        return Number(req.query?.event_id ?? req.body?.event_id) || null;
    }

    /*
      The wizard's catalogue (templates, menus, limits) is the OWNER's plan's.
      The call names no event, so an organizer with no plan of their own gets
      the catalogue of the newest event they organise.
    */
    if (path === '/event-options' && !req.websiteClient.subscription_plan_id) {
        return Math.max(...organised.keys());
    }
    return null;
};

const refuse = (res, message) => res.status(403).json({ success: false, message });

const eventOrganizerAccess = async (req, res, next) => {
    try {
        const caller = req.websiteClient;
        if (!caller) return next();

        const organised = await organisedBy(caller.id);
        // Nearly everybody: organises nothing, nothing to do, no extra query.
        if (!organised.size) return next();

        // An organizer creates no events — only a client (who holds a plan) does.
        if (req.method === 'POST' && /^\/events\/?$/.test(req.path) && !caller.subscription_plan_id) {
            return refuse(res, 'Only the client can create events.');
        }

        const eventId = await targetEvent(req, organised);
        const ownerId = eventId ? organised.get(eventId) : null;
        if (!ownerId) return next();

        // Full control of the event, short of removing it.
        if (req.method === 'DELETE' && /^\/events\/\d+\/?$/.test(req.path)) {
            return refuse(res, 'Only the client who owns this event can delete it.');
        }

        const owner = await ownerOf(ownerId);
        if (!owner || Number(owner.is_active) !== 1) return next();

        req.organizerClient = caller;
        req.organizerEventId = eventId;
        req.websiteClient = owner;
        req.companyId = owner.company_id ?? null;
        return next();
    } catch (err) {
        return next(err);
    }
};

module.exports = { eventOrganizerAccess, organisedBy, forget };
