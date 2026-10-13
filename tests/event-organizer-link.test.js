/**
 * An event's organizer as a person who can sign in — the LINK only
 * (`events.organizer_client_id`, eventOrganizer.service) and the mobile login
 * that uses it. Runs against the LOCAL database, no server needed:
 *
 *   node tests/event-organizer-link.test.js
 *
 * No code is delivered: the OTP send is not reached with a real provider
 * locally, and the test verifies with the hash it writes itself. It restores
 * the event it borrows and deletes the account it creates.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const m = require('../src/models');
const organizer = require('../src/services/eventOrganizer.service');
const clients = require('../src/services/websiteClient.service');

const ok = (label, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
    if (!cond) process.exitCode = 1;
};
const fails = async (label, fn, text) => {
    try { await fn(); ok(label, false, '(did not throw)'); } catch (e) {
        ok(label, !text || e.message.includes(text), `-> ${e.message}`);
    }
};

/** A number nobody has: 10 digits starting 70000, checked against both tables. */
const freeNumber = async () => {
    for (let i = 0; i < 50; i += 1) {
        const n = `70000${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
        /* eslint-disable no-await-in-loop */
        const taken = await m.WebsiteClient.unscoped().count({ where: { mobile: n } })
            || await m.EventParticipant.count({ where: { mobile: n } })
            || (await organizer.eventsForNumber(n, 1)).length;
        /* eslint-enable no-await-in-loop */
        if (!taken) return n;
    }
    throw new Error('no free test number');
};

(async () => {
    ok('nationalOf strips to the last 10', organizer.nationalOf('+91 98846-99435') === '9884699435');
    ok('nationalOf: nothing typed', organizer.nationalOf('') === null && organizer.nationalOf('12') === null);
    ok('dialOf', organizer.dialOf('+91 98846 99435') === '+91' && organizer.dialOf('9884699435') === '+91'
        && organizer.dialOf('+971 9884699435') === '+971');

    const event = await m.Event.findOne({ order: [['id', 'DESC']] });
    if (!event) { console.log('no event locally'); return; }
    const owner = await m.WebsiteClient.unscoped().findByPk(event.website_client_id);
    const before = { contact_phone: event.contact_phone, organizer_client_id: event.organizer_client_id, organizer: event.organizer };
    const number = await freeNumber();
    let madeId = null;
    console.log(`event ${event.id} owner ${owner.id} vendor ${owner.vendor_id} test number ${number}`);

    try {
        await fails('a number on nothing cannot sign in',
            () => clients.requestLoginOtp({ mobile: number, login_as: 'organizer' }, owner.vendor_id), 'No account');

        // The owner types the organizer's number on the event.
        await event.update({ contact_phone: `+91 ${number.slice(0, 5)} ${number.slice(5)}`, organizer: 'Test Organizer' });
        ok('no account yet -> the event is linked to nobody', await organizer.syncEvent(event) === null);
        ok('the event is found by that number',
            (await organizer.eventsForNumber(number, owner.vendor_id)).some((e) => e.id === event.id));
        ok('...but not inside another tenant',
            (await organizer.eventsForNumber(number, owner.vendor_id + 9999)).length === 0);

        // The organizer signs in for the first time.
        await clients.requestLoginOtp({ mobile: number, login_as: 'organizer' }, owner.vendor_id).catch((e) => {
            // Reaching the delivery step is enough: the account and the code exist by then.
            if (!/deliver|send|sms|whatsapp|otp/i.test(e.message)) throw e;
        });
        const made = await m.WebsiteClient.unscoped().findOne({ where: { mobile: number, vendor_id: owner.vendor_id } });
        madeId = made?.id ?? null;
        ok('first sign-in creates the account, named after the organizer',
            Boolean(made) && made.name === 'Test Organizer' && made.dial_code === '+91', made ? `#${made.id}` : '');
        await event.reload();
        ok('...and the event now points at it', Number(event.organizer_client_id) === Number(madeId));
        ok('the organizer organises 1, owns 0',
            await organizer.countOrganised(madeId) === 1
            && await m.Event.count({ where: { website_client_id: madeId } }) === 0);

        // Verify with a code this test hashes itself.
        await m.WebsiteClient.unscoped().update(
            { otp_hash: await bcrypt.hash('123456', 4), otp_expires_at: new Date(Date.now() + 60000), otp_attempts: 0 },
            { where: { id: madeId }, hooks: false },
        );
        const signedIn = await clients.verifyLoginOtp({ mobile: number, otp: '123456' }, owner.vendor_id);
        ok('the code signs that account in', Number(signedIn.id) === Number(madeId));

        // The owner's own number on their own event links nobody.
        if (owner.mobile) {
            await event.update({ contact_phone: owner.mobile });
            ok("the owner's own number links nobody", await organizer.syncEvent(event) === null);
            await event.reload();
            ok('...and the event is unlinked again', event.organizer_client_id === null);
        }

        // A second number that already has an account is linked on save.
        await event.update({ contact_phone: number });
        ok('a number WITH an account is linked on save', await organizer.syncEvent(event) === Number(madeId));

        // Number removed -> nobody.
        await event.update({ contact_phone: null });
        ok('number removed -> unlinked', await organizer.syncEvent(event) === null);
        await fails('...and that number is no longer an organizer',
            () => clients.requestLoginOtp({ mobile: number, login_as: 'organizer' }, owner.vendor_id), 'not registered as an event organizer');
    } finally {
        await m.Event.update(before, { where: { id: event.id } });
        if (madeId) await m.WebsiteClient.unscoped().destroy({ where: { id: madeId }, force: true });
        const left = await m.WebsiteClient.unscoped().count({ where: { mobile: number }, paranoid: false });
        ok('cleanup', left === 0);
    }
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; }).finally(() => m.sequelize.close());
