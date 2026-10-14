/*
 * "Change Photo" from the ⋮ menus (2026-10-14) — through the services (no
 * server needed).
 *
 * The app's Change Photo sends `{ photo: <url> }` and NOTHING else. This file
 * proves, for each list that offers it, that such an update
 *   · changes the photo,
 *   · leaves every other field exactly as it was (a partial update must not
 *     blank the name, mobile, side, relationship, notes …),
 *   · and that the same update works again (replacing a photo).
 *
 * Covers: phone-book guest, event participant, family member, organizer.
 * Everything it creates is deleted; the event's organizer fields are put back.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/change-photo.test.js
 * Needs the local DB with at least one event.
 */
require('dotenv').config();

const { Event } = require('../src/models');
const guests = require('../src/services/clientGuest.service');
const participants = require('../src/services/clientParticipant.service');
const family = require('../src/services/clientFamily.service');
const organizer = require('../src/controllers/clientOrganizerContact.controller');

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

const same = (before, after, fields) => fields.filter((f) => String(before[f] ?? '') !== String(after[f] ?? ''));

/** Calls an express-style controller with a fake req / res. */
const callController = (handler, req) => new Promise((resolve, reject) => {
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    handler(req, res, reject);
});

(async () => {
    const event = await Event.findOne({ order: [['id', 'DESC']] });
    if (!event) { console.log('SKIP  no event on this database'); process.exit(0); }
    const client = Number(event.website_client_id);
    const company = Number(event.company_id) || 1;
    const stamp = Date.now();
    const madeGuests = []; const madeParticipants = []; const madeFamily = [];
    const originalOrganizer = {
        organizer: event.organizer, organizer_image: event.organizer_image,
        contact_phone: event.contact_phone, contact_email: event.contact_email,
        venue_address: event.venue_address, description: event.description,
    };

    try {
        console.log(`Event #${event.id} · client #${client}`);

        // ── Phone-book guest ──────────────────────────────────────────────
        const g = await guests.createGuest(client, company, {
            first_name: 'PhotoTest', last_name: 'Guest', mobile: `90000${String(stamp).slice(-5)}`,
            dial_code: '+91', email: 'photo.guest@example.com', notes: 'keep me',
            photo: '/uploads/test/old-guest.jpg',
        });
        madeGuests.push(g.id);
        const gBefore = await guests.getGuestById(client, g.id);
        await guests.updateGuest(client, g.id, { photo: '/uploads/test/new-guest.jpg' });
        const gAfter = await guests.getGuestById(client, g.id);
        ok('guest: the photo changed', gAfter.photo === '/uploads/test/new-guest.jpg', `got ${gAfter.photo}`);
        const gDiff = same(gBefore, gAfter, ['name', 'first_name', 'last_name', 'mobile', 'dial_code', 'email', 'notes']);
        ok('guest: nothing else changed', gDiff.length === 0, gDiff.join(', '));
        await guests.updateGuest(client, g.id, { photo: '/uploads/test/newer-guest.jpg' });
        ok('guest: a second change works', (await guests.getGuestById(client, g.id)).photo === '/uploads/test/newer-guest.jpg');

        // ── Event participant ─────────────────────────────────────────────
        const p = await participants.createParticipant(client, company, {
            event_id: event.id, first_name: 'PhotoTest', last_name: 'Participant',
            mobile: `91111${String(stamp).slice(-5)}`, dial_code: '+91', side: 'bride',
            relationship: 'Friend', party_size: 3, notes: 'keep me', photo: '/uploads/test/old-p.jpg',
        });
        madeParticipants.push(p.id);
        const pBefore = await participants.getParticipantById(client, p.id);
        await participants.updateParticipant(client, p.id, { photo: '/uploads/test/new-p.jpg' });
        const pAfter = await participants.getParticipantById(client, p.id);
        ok('participant: the photo changed', pAfter.photo === '/uploads/test/new-p.jpg', `got ${pAfter.photo}`);
        const pDiff = same(pBefore, pAfter, [
            'name', 'first_name', 'last_name', 'mobile', 'rsvp_side', 'relationship',
            'party_size', 'notes', 'rsvp_status', 'response_type',
        ]);
        ok('participant: nothing else changed (side, relation, party size, RSVP)', pDiff.length === 0, pDiff.join(', '));

        // ── Family member ─────────────────────────────────────────────────
        const f = await family.create(client, event.id, {
            first_name: 'PhotoTest', last_name: 'Family', side: 'groom', relationship: 'Uncle',
            mobile: '9822211111', notes: 'keep me', photo: '/uploads/test/old-f.jpg',
        });
        madeFamily.push(f.id);
        const fBefore = await family.getOne(client, f.id);
        await family.update(client, f.id, { photo: '/uploads/test/new-f.jpg' });
        const fAfter = await family.getOne(client, f.id);
        ok('family: the photo changed', fAfter.photo === '/uploads/test/new-f.jpg', `got ${fAfter.photo}`);
        const fDiff = same(fBefore, fAfter, ['full_name', 'first_name', 'last_name', 'side', 'relationship', 'mobile', 'notes', 'sort_order']);
        ok('family: nothing else changed (name, side, relation, order)', fDiff.length === 0, fDiff.join(', '));

        // ── Organizer ─────────────────────────────────────────────────────
        const call = (body) => callController(organizer.updateContact, {
            params: { id: event.id }, websiteClient: { id: client }, body,
        });
        await call({ name: 'PhotoTest Organizer', mobile: '9811122222', email: 'org@example.com', address: 'Keep Street', description: 'keep me' });
        const before = await Event.findByPk(event.id);
        await call({ photo: '/uploads/test/new-org.jpg' });
        const after = await Event.findByPk(event.id);
        ok('organizer: the photo changed', after.organizer_image === '/uploads/test/new-org.jpg', `got ${after.organizer_image}`);
        const oDiff = same(before, after, ['organizer', 'contact_phone', 'contact_email', 'venue_address', 'description']);
        ok('organizer: nothing else changed (name, mobile, email, address, about)', oDiff.length === 0, oDiff.join(', '));
    } finally {
        for (const id of madeParticipants) await participants.deleteParticipant(client, id).catch(() => {});
        for (const id of madeGuests) await guests.deleteGuest(client, id).catch(() => {});
        for (const id of madeFamily) await family.remove(client, id).catch(() => {});
        await Event.update(originalOrganizer, { where: { id: event.id } });
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
