/*
 * The event QR — bound to the encrypted event id, made once, read live.
 *
 * ── WHAT THIS FILE IS GUARDING ──────────────────────────────────────────────
 *   · the code carries the event id and nothing else, and is short
 *   · editing the event does NOT change the code
 *   · a scan (what the app's scan page calls) reads the LIVE event
 *   · an old, longer code from before this change still works
 *   · a tampered or foreign code is refused
 *
 * Works on one real local event and puts its QR columns and tagline back.
 *   node tests/event-qr.test.js
 */
require('dotenv').config();
const { sequelize, Event } = require('../src/models');
const eventQr = require('../src/utils/eventQr');
const eventService = require('../src/services/clientEvent.service');
const registration = require('../src/services/guestRegistration.service');

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};
const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

(async () => {
    const event = await Event.findOne({ attributes: ['id', 'name', 'website_client_id', 'tagline', 'qr_token', 'qr_version', 'qr_issued_at'] });
    if (!event) { console.log('SKIP  no event on this database'); process.exit(0); }
    const id = event.id;
    const owner = event.website_client_id;
    const original = {
        qr_token: event.qr_token, qr_version: event.qr_version, qr_issued_at: event.qr_issued_at, tagline: event.tagline,
    };

    try {
        // ── The code itself ───────────────────────────────────────────────
        const code = eventQr.issueToken({ id });
        const payload = eventQr.decrypt(code);
        ok('the code carries the event id', payload.eid === id);
        ok('and nothing about the event', Object.keys(payload).sort().join() === 'eid,ts,v', JSON.stringify(payload));
        ok('so it is short', code.length < 120, `${code.length} chars`);
        ok('and is not a bare id', !/^\d+$/.test(code) && code.startsWith('EVQ'));

        await Event.update({ qr_token: code, qr_version: eventQr.QR_VERSION, qr_issued_at: eventQr.issuedNow() }, { where: { id } });

        // ── The scan page's call: resolve reads the LIVE event ────────────
        const first = await registration.resolveInvite(code);
        ok('a scan resolves to the event', first.event && first.event.id === id);
        await Event.update({ tagline: 'Live tagline one' }, { where: { id } });
        const afterEdit = await registration.resolveInvite(code);
        ok('and shows the current details, not a snapshot', afterEdit.event.tagline === 'Live tagline one',
            String(afterEdit.event.tagline));

        // ── Editing does not change the code ──────────────────────────────
        await eventService.updateEvent(owner, id, { tagline: 'Live tagline two' });
        ok('editing the event leaves the QR code alone', (await Event.findByPk(id)).qr_token === code);
        ok('the same code still resolves after an edit', (await registration.resolveInvite(code)).event.tagline === 'Live tagline two');

        // ── An older, longer code still works ─────────────────────────────
        const old = eventQr.encrypt({
            v: 1, eid: id, cid: 1, vid: null, clid: owner, pid: 1, cat: 1, nm: 'Old snapshot name',
            sd: '2026-01-01', ed: '2026-01-02', st: '10:00', et: '12:00', ts: 1700000000,
        });
        ok('a code made before this change still admits', (await registration.eventFromToken(old)).id === id);
        ok('and still shows the live event, not its old snapshot',
            (await registration.resolveInvite(old)).event.tagline === 'Live tagline two');

        // ── The host decode reads the live event too ──────────────────────
        const decoded = await eventService.resolveQrToken(code);
        ok('the host decode reads the live event', decoded && decoded.event && decoded.event.id === id);

        // ── Bad codes ─────────────────────────────────────────────────────
        ok('a tampered code is refused', !!(await refused(() => registration.eventFromToken(`${code.slice(0, -2)}xx`))));
        ok('a plain event id is refused', !!(await refused(() => registration.eventFromToken(String(id)))));
        ok('an unknown event id inside a valid code is refused',
            !!(await refused(() => registration.eventFromToken(eventQr.encrypt({ v: 1, eid: 2147483000, ts: 1 })))));
    } finally {
        await Event.update(original, { where: { id } });
        await sequelize.close();
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await sequelize.close(); } catch { /* ignore */ } process.exit(1); });
