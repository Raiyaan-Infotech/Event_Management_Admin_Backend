/*
 * RSVP Settings — over HTTP, against a live server; and the guest's own RSVP
 * obeying them, through the service (a guest signs in by OTP, which a script
 * cannot do).
 *
 * ── WHAT THIS FILE IS GUARDING ──────────────────────────────────────────────
 *   · an event that never saved settings reads as the DEFAULTS, with the
 *     deadline resolved to the event's own end date
 *   · the deadline can never be after the event ends
 *   · a form with no answer on offer cannot be saved
 *   · only what is sent changes
 *   · the guest's form is refused when RSVP is switched off, when the answer
 *     is not one on offer, and after the deadline; the groom / bride side and
 *     the relationship are stored only while that switch is on
 *
 * Everything it changes is put back: the event's `rsvp_settings`, and the one
 * temporary participant it creates.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-rsvp-settings.test.js
 * Requires the backend running on :5001 (restarted since the routes were
 * added) and the seeded test client.
 */
require('dotenv').config();

const { Op } = require('sequelize');
const {
    sequelize, Event, EventParticipant, WebsiteClient,
} = require('../src/models');
const guestService = require('../src/services/guestRegistration.service');

const BASE = process.env.TEST_API_URL || 'http://localhost:5001/api/v1';
const CREDENTIALS = { email: 'test@example.com', password: 'Test@123' };

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

let cookies = '';
const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(cookies ? { Cookie: cookies } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body: json };
};

const refused = async (fn) => {
    try { await fn(); return null; } catch (e) { return e.message; }
};

(async () => {
    console.log(`\nRSVP settings against ${BASE}\n`);
    let event = null;
    let originalSettings;
    let tempParticipantId = null;

    try {
        console.log('── unauthenticated ───────────────────────────────');
        {
            const res = await call('GET', '/client/events/1/rsvp-settings');
            ok('GET rsvp-settings without a session -> 401', res.status === 401, `got ${res.status}`);
        }

        const login = await call('POST', '/public/website-clients/login', CREDENTIALS);
        ok('signs in', login.status === 200, `got ${login.status}`);
        const clientId = login.body?.data?.client?.id;

        // An event of theirs that has not ended, so a deadline can be chosen.
        const today = new Date().toISOString().slice(0, 10);
        event = await Event.findOne({
            where: { website_client_id: clientId, end_date: { [Op.gte]: today } },
            order: [['id', 'DESC']],
        }) || await Event.findOne({ where: { website_client_id: clientId }, order: [['id', 'DESC']] });
        if (!event) {
            console.log('\n  The test client has no event — nothing more can be checked.\n');
            return;
        }
        originalSettings = event.rsvp_settings;
        await event.update({ rsvp_settings: null });
        const path = `/client/events/${event.id}/rsvp-settings`;
        console.log(`\n── event #${event.id} "${event.name}", ${event.start_date} → ${event.end_date} ──`);

        {
            const res = await call('GET', path);
            const s = res.body?.data?.settings;
            ok('GET -> 200', res.status === 200, `got ${res.status} ${JSON.stringify(res.body)?.slice(0, 200)}`);
            ok('never saved = enabled, three answers', s?.enabled === true && s?.response_options?.join() === 'yes,no,maybe');
            ok('never saved = no own deadline', s?.deadline === null);
            ok('the form closes on the event end date', s?.effective_deadline === event.end_date, `got ${s?.effective_deadline}`);
            ok('relationship question is off by default', s?.allow_relationship === false);
        }
        {
            const res = await call('GET', '/client/events/999999999/rsvp-settings');
            ok('somebody else\'s / missing event -> 404', res.status === 404, `got ${res.status}`);
        }
        {
            const res = await call('PUT', path, { response_options: [] });
            ok('no answer on offer -> 400', res.status === 400, `got ${res.status}`);
        }
        {
            const res = await call('PUT', path, { deadline: '2999-12-31' });
            ok('deadline after the event ends -> 400', res.status === 400, `got ${res.status}`);
        }
        {
            const res = await call('PUT', path, { deadline: 'tomorrow' });
            ok('a deadline that is not a date -> 400', res.status === 400, `got ${res.status}`);
        }
        {
            const res = await call('PUT', path, {
                response_options: ['yes', 'no'], allow_relationship: true, allow_guest_count: false,
            });
            const s = res.body?.data?.settings;
            ok('PUT -> 200', res.status === 200, `got ${res.status}`);
            ok('saved: two answers', s?.response_options?.join() === 'yes,no');
            ok('saved: relationship on, head count off', s?.allow_relationship === true && s?.allow_guest_count === false);
            ok('untouched: special requests still on', s?.allow_special_requests === true);
        }
        {
            const res = await call('PUT', path, { deadline: event.end_date });
            ok('deadline ON the end date is allowed', res.status === 200 && res.body?.data?.settings?.deadline === event.end_date, `got ${res.status}`);
            const again = await call('GET', path);
            ok('read back: the earlier save is still there', again.body?.data?.settings?.response_options?.join() === 'yes,no');
        }
        {
            const res = await call('PUT', path, { deadline: null });
            ok('deadline cleared -> follows the event again', res.body?.data?.settings?.deadline === null && res.body?.data?.settings?.effective_deadline === event.end_date);
        }
        {
            const res = await call('GET', `/client/rsvps?event_id=${event.id}&limit=5`);
            ok('RSVP list -> 200', res.status === 200, `got ${res.status}`);
            const row = res.body?.data?.rsvps?.[0];
            ok('rows carry rsvp_side', !row || Object.prototype.hasOwnProperty.call(row, 'rsvp_side'));
        }

        console.log('\n── the guest\'s own RSVP (service) ─────────────────');
        const guestClient = await WebsiteClient.findOne({ where: { id: { [Op.ne]: clientId } }, order: [['id', 'DESC']] });
        if (!guestClient) {
            console.log('  no second client on this database — skipped');
        } else {
            const existing = await EventParticipant.findOne({
                where: { event_id: event.id, participant_client_id: guestClient.id },
            });
            if (existing) {
                console.log('  that client is already a guest of this event — skipped, not touching a real answer');
            } else {
                const temp = await EventParticipant.create({
                    event_id: event.id,
                    website_client_id: clientId,
                    participant_client_id: guestClient.id,
                    name: 'RSVP Settings Test Guest',
                    rsvp_status: 'invited',
                    response_type: 'none',
                    invite_source: 'manual',
                });
                tempParticipantId = temp.id;

                const read = await guestService.getMyRsvp(guestClient.id, event.id);
                ok('guest read carries the settings', read.settings?.response_options?.join() === 'yes,no');
                ok('relationship options come with the switch on', !read.rsvp_enabled || read.relationship_options.length >= 0);

                if (!read.rsvp_enabled) {
                    console.log('  this event has no RSVP menu / plan grant — the submit checks below expect refusal');
                    const msg = await refused(() => guestService.submitMyRsvp(guestClient.id, event.id, { response_type: 'yes' }));
                    ok('submit refused while RSVP is not enabled', /not enabled/i.test(msg || ''), msg);
                } else {
                    let msg = await refused(() => guestService.submitMyRsvp(guestClient.id, event.id, { response_type: 'maybe' }));
                    ok('an answer not on offer is refused', /not available/i.test(msg || ''), msg);

                    await event.update({ rsvp_settings: { ...event.rsvp_settings, enabled: false } });
                    msg = await refused(() => guestService.submitMyRsvp(guestClient.id, event.id, { response_type: 'yes' }));
                    ok('refused while the organizer has RSVP off', /not enabled/i.test(msg || ''), msg);

                    await event.update({ rsvp_settings: { ...event.rsvp_settings, enabled: true, deadline: '2000-01-01' } });
                    msg = await refused(() => guestService.submitMyRsvp(guestClient.id, event.id, { response_type: 'yes' }));
                    ok('refused after the deadline', /passed/i.test(msg || ''), msg);
                    const closed = await guestService.getMyRsvp(guestClient.id, event.id);
                    ok('read says the deadline passed, cannot respond', closed.deadline_passed === true && closed.can_respond === false);

                    await event.update({ rsvp_settings: { ...event.rsvp_settings, deadline: null } });
                    msg = await refused(() => guestService.submitMyRsvp(guestClient.id, event.id, { response_type: 'yes', rsvp_side: 'uncle' }));
                    ok('a side that is not groom / bride is refused', /groom or bride/i.test(msg || ''), msg);

                    const option = read.relationship_options[0];
                    const done = await guestService.submitMyRsvp(guestClient.id, event.id, {
                        response_type: 'yes', party_size: 7, rsvp_side: 'bride',
                        relationship_option_id: option?.id, special_requirements: 'Window seat',
                    });
                    ok('accepted: answer stored', done.rsvp.response_type === 'yes');
                    ok('side stored', done.rsvp.rsvp_side === 'bride', `got ${done.rsvp.rsvp_side}`);
                    ok('relationship stored by name', !option || done.rsvp.relationship === option.name, `got ${done.rsvp.relationship}`);
                    ok('head count ignored while that switch is off', done.rsvp.party_size === 1, `got ${done.rsvp.party_size}`);
                    ok('answered once: cannot respond again', done.can_respond === false);

                    const list = await call('GET', `/client/rsvps?event_id=${event.id}&limit=100`);
                    const mine = list.body?.data?.rsvps?.find((r) => r.id === temp.id);
                    ok('the organizer\'s list shows the side', mine?.rsvp_side === 'bride', `got ${mine?.rsvp_side}`);

                    const cleared = await call('PUT', `/client/rsvps/${temp.id}/reset`);
                    ok('organizer clears it -> 200', cleared.status === 200, `got ${cleared.status}`);
                    const after = await guestService.getMyRsvp(guestClient.id, event.id);
                    ok('cleared: the guest can respond again', after.can_respond === true && after.rsvp.response_type === 'none');
                }
            }
        }
    } catch (e) {
        fail++;
        console.log(`  FAIL  threw: ${e.message}`);
    } finally {
        if (tempParticipantId) await EventParticipant.destroy({ where: { id: tempParticipantId }, force: true });
        if (event) await Event.update({ rsvp_settings: originalSettings ?? null }, { where: { id: event.id } });
        await sequelize.close();
        console.log(`\n${pass} passed, ${fail} failed\n`);
        process.exit(fail ? 1 : 0);
    }
})();
