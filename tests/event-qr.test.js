/*
 * The event QR — bound to the event id, stable, and replaceable.
 *
 * ── WHAT THIS FILE IS GUARDING ──────────────────────────────────────────────
 *   · the code carries the event id and nothing else, and is short
 *   · editing the event does NOT change the code
 *   · an event on the old scheme (version 1) keeps every old code working
 *   · Regenerate gives a new code and kills the old one; only the owner can
 *   · a scan reads the LIVE event
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
    const event = await Event.findOne({ attributes: ['id', 'website_client_id', 'tagline', 'qr_token', 'qr_version', 'qr_issued_at'] });
    if (!event) { console.log('SKIP  no event on this database'); process.exit(0); }
    const id = event.id;
    const owner = event.website_client_id;
    const original = {
        qr_token: event.qr_token, qr_version: event.qr_version, qr_issued_at: event.qr_issued_at, tagline: event.tagline,
    };

    try {
        // ── The code itself ───────────────────────────────────────────────
        const sample = eventQr.issueToken({ id });
        const payload = eventQr.decrypt(sample);
        ok('the code carries the event id', payload.eid === id);
        ok('and nothing about the event', Object.keys(payload).sort().join() === 'eid,ts,v', JSON.stringify(payload));
        ok('so it is short', sample.length < 120, `${sample.length} chars`);

        // ── An older event: every old code keeps working ──────────────────
        const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
        const legacy = eventQr.issueToken({ id }, past);
        await Event.update({ qr_token: legacy, qr_version: 1, qr_issued_at: new Date() }, { where: { id } });
        ok('an old-scheme event still accepts an old code', (await registration.eventFromToken(legacy)).id === id);

        // ── Editing does not change the code ──────────────────────────────
        const before = (await Event.findByPk(id)).qr_token;
        await eventService.updateEvent(owner, id, { tagline: 'QR test tagline' });
        const after = (await Event.findByPk(id)).qr_token;
        ok('editing the event leaves the QR code alone', before === after);

        // ── Regenerate ────────────────────────────────────────────────────
        ok('a stranger cannot regenerate', (await eventService.regenerateQr(999999999, id)) === null);
        const regenerated = await eventService.regenerateQr(owner, id);
        const fresh = regenerated.qr_token;
        ok('regenerate gives a different code', fresh !== legacy && fresh !== before);
        ok('the event moves to the stable scheme', Number((await Event.findByPk(id)).qr_version) === eventQr.SCHEME);
        ok('the new code admits', (await registration.eventFromToken(fresh)).id === id);
        const oldMsg = await refused(() => registration.eventFromToken(legacy));
        ok('the OLD code no longer admits', !!oldMsg && /no longer valid/i.test(oldMsg), String(oldMsg));
        ok('the host decode refuses the old code too', (await eventService.resolveQrToken(legacy)) === null);
        const decoded = await eventService.resolveQrToken(fresh);
        ok('the host decode reads the live event', decoded && decoded.event && decoded.event.id === id);

        // ── After regenerating, edits still leave it alone ────────────────
        await eventService.updateEvent(owner, id, { tagline: 'Another change' });
        ok('an edit after regenerating keeps the new code', (await Event.findByPk(id)).qr_token === fresh);
        ok('and the new code still admits', (await registration.eventFromToken(fresh)).id === id);

        // ── A scan reads the live event ───────────────────────────────────
        ok('a scan sees the current tagline', (await registration.eventFromToken(fresh)).tagline === 'Another change');
        ok('a tampered code is refused', !!(await refused(() => registration.eventFromToken(`${fresh.slice(0, -2)}xx`))));
    } finally {
        await Event.update(original, { where: { id } });
        await sequelize.close();
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await sequelize.close(); } catch { /* ignore */ } process.exit(1); });
