/**
 * What an event's ORGANIZER may reach — middleware/eventOrganizerAccess.js.
 * Runs against the LOCAL database, no server needed:
 *
 *   node tests/event-organizer-access.test.js
 *
 * It borrows the newest event, makes a throw-away organizer account and a
 * throw-away stranger, drives the middleware with request shapes the app
 * really sends, and puts everything back. Nothing is sent to anybody.
 */
require('dotenv').config();
const m = require('../src/models');
const organizer = require('../src/services/eventOrganizer.service');
const { eventOrganizerAccess, organisedBy, forget } = require('../src/middleware/eventOrganizerAccess');
const agenda = require('../src/services/clientAgenda.service');
const eventService = require('../src/services/clientEvent.service');

const ok = (label, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
    if (!cond) process.exitCode = 1;
};

/** Run the middleware for one request; says who the request continues as. */
const run = async (caller, method, path, { query = {}, body = {} } = {}) => {
    const req = { websiteClient: caller, method, path, query, body };
    const out = { status: 200, message: null, nexted: false };
    const res = {
        status(code) { out.status = code; return this; },
        json(payload) { out.message = payload?.message ?? null; return this; },
    };
    await eventOrganizerAccess(req, res, (err) => { if (err) throw err; out.nexted = true; });
    return { ...out, as: Number(req.websiteClient.id), organizer: req.organizerClient ? Number(req.organizerClient.id) : null };
};

const freeNumber = async () => {
    for (let i = 0; i < 50; i += 1) {
        const n = `70001${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
        /* eslint-disable no-await-in-loop */
        const taken = await m.WebsiteClient.unscoped().count({ where: { mobile: n } })
            || (await organizer.eventsForNumber(n, 1)).length;
        /* eslint-enable no-await-in-loop */
        if (!taken) return n;
    }
    throw new Error('no free test number');
};

(async () => {
    // An owner with at least two events, so "the owner's OTHER event" can be tried.
    const [busiest] = await m.Event.findAll({
        attributes: ['website_client_id', [m.Sequelize.fn('COUNT', m.Sequelize.col('id')), 'n']],
        group: ['website_client_id'],
        order: [[m.Sequelize.literal('n'), 'DESC']],
        limit: 1,
        raw: true,
    });
    const events = await m.Event.findAll({
        where: { website_client_id: busiest.website_client_id }, order: [['id', 'DESC']], limit: 2,
    });
    const [event, other] = events;
    const owner = await m.WebsiteClient.findByPk(event.website_client_id);
    const before = { contact_phone: event.contact_phone, organizer_client_id: event.organizer_client_id };
    const made = [];
    console.log(`event ${event.id}, other ${other?.id ?? '—'}, owner ${owner.id}`);

    try {
        const account = async (name) => {
            const c = await m.WebsiteClient.create({
                name, dial_code: '+91', mobile: await freeNumber(), vendor_id: owner.vendor_id,
                company_id: owner.company_id ?? null, source: 'website', is_active: 1,
            });
            made.push(c.id);
            return m.WebsiteClient.findByPk(c.id);
        };
        const org = await account('Access Test Organizer');
        const stranger = await account('Access Test Stranger');

        // The owner names the organizer by typing their number on the event.
        await event.update({ contact_phone: `+91 ${org.mobile}` });
        ok('saving the number links the organizer', await organizer.syncEvent(event) === Number(org.id));
        ok('organisedBy knows it', (await organisedBy(org.id)).get(Number(event.id)) === Number(owner.id));

        const E = event.id;
        const asOwner = (r) => r.nexted && r.as === Number(owner.id) && r.organizer === Number(org.id);
        const asSelf = (r, who) => r.nexted && r.as === Number(who.id) && r.organizer === null;

        // ── the organizer, on their event ──
        ok('GET /events/:id            -> as the owner', asOwner(await run(org, 'GET', `/events/${E}`)));
        ok('PUT /events/:id            -> as the owner', asOwner(await run(org, 'PUT', `/events/${E}`)));
        ok('GET /events/:id/agenda     -> as the owner', asOwner(await run(org, 'GET', `/events/${E}/agenda`)));
        ok('POST /events/:id/gallery   -> as the owner', asOwner(await run(org, 'POST', `/events/${E}/gallery`)));
        ok('GET /events/:id/notifications -> as the owner', asOwner(await run(org, 'GET', `/events/${E}/notifications`)));
        ok('GET /participants?event_id -> as the owner',
            asOwner(await run(org, 'GET', '/participants', { query: { event_id: String(E) } })));
        ok('POST /participants {event_id} -> as the owner',
            asOwner(await run(org, 'POST', '/participants', { body: { event_id: E } })));
        ok('GET /rsvps/stats?event_id  -> as the owner',
            asOwner(await run(org, 'GET', '/rsvps/stats', { query: { event_id: String(E) } })));
        ok('GET /event-options         -> the owner\'s plan', asOwner(await run(org, 'GET', '/event-options')));

        const participant = await m.EventParticipant.findOne({ where: { event_id: E } });
        if (participant) {
            ok('GET /participants/:id (theirs) -> as the owner',
                asOwner(await run(org, 'GET', `/participants/${participant.id}`)));
            ok('PUT /rsvps/:id (theirs)        -> as the owner',
                asOwner(await run(org, 'PUT', `/rsvps/${participant.id}`)));
        }

        // ── what they may NOT do ──
        const del = await run(org, 'DELETE', `/events/${E}`);
        ok('DELETE /events/:id         -> refused', !del.nexted && del.status === 403, del.message || '');
        const create = await run(org, 'POST', '/events');
        ok('POST /events               -> refused', !create.nexted && create.status === 403, create.message || '');

        // ── what stays the caller's own ──
        ok('GET /events (the list)     -> as themselves', asSelf(await run(org, 'GET', '/events'), org));
        ok('GET /billing/overview      -> as themselves', asSelf(await run(org, 'GET', '/billing/overview'), org));
        ok('GET /guests                -> as themselves', asSelf(await run(org, 'GET', '/guests'), org));
        ok('GET /me                    -> as themselves', asSelf(await run(org, 'GET', '/me'), org));
        ok('GET /participants (no event) -> as themselves', asSelf(await run(org, 'GET', '/participants'), org));
        ok('POST /events/:id/wishlist  -> as themselves', asSelf(await run(org, 'POST', `/events/${E}/wishlist`), org));

        // ── the owner's OTHER event stays closed ──
        if (other) {
            ok("GET /events/<owner's other event> -> as themselves",
                asSelf(await run(org, 'GET', `/events/${other.id}`), org));
            ok("GET /participants?event_id=<other> -> as themselves",
                asSelf(await run(org, 'GET', '/participants', { query: { event_id: String(other.id) } }), org));
            const theirs = await m.EventParticipant.findOne({ where: { event_id: other.id } });
            if (theirs) {
                ok("PUT /participants/<row of the other event> -> as themselves",
                    asSelf(await run(org, 'PUT', `/participants/${theirs.id}`), org));
            }
        }

        // ── somebody else entirely, and the owner ──
        ok('a stranger on the event    -> as themselves', asSelf(await run(stranger, 'GET', `/events/${E}/agenda`), stranger));
        const ownDelete = await run(owner, 'DELETE', `/events/${E}`);
        ok('the owner may still delete', ownDelete.nexted && ownDelete.as === Number(owner.id) && ownDelete.organizer === null);

        // ── and the services really answer for the swapped caller, and not for the bare one ──
        const swapped = await run(org, 'GET', `/events/${E}/agenda`);
        const page = await agenda.list(swapped.as, E);
        ok('agenda reads for the organizer (as owner)', Array.isArray(page.items));
        let refused = false;
        try { await agenda.list(org.id, E); } catch { refused = true; }
        ok('agenda refuses the organizer account on its own', refused);
        ok('the event reads for the organizer (as owner)', Boolean(await eventService.getEventById(swapped.as, E)));
        ok('...and not for the stranger', await eventService.getEventById(stranger.id, E) === null);

        // ── number removed: access ends at once (the cache is cleared) ──
        await event.update({ contact_phone: null });
        await organizer.syncEvent(event);
        ok('number removed -> no longer the owner', asSelf(await run(org, 'GET', `/events/${E}/agenda`), org));
    } finally {
        await m.Event.update(before, { where: { id: event.id } });
        if (made.length) await m.WebsiteClient.unscoped().destroy({ where: { id: made }, force: true });
        forget();
        ok('cleanup', await m.WebsiteClient.unscoped().count({ where: { id: made }, paranoid: false }) === 0);
    }
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; }).finally(() => m.sequelize.close());
