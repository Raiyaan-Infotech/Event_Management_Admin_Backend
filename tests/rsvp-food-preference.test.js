/**
 * RSVP "Allow Food Preference" — the setting, and the guest's own RSVP obeying
 * it (clientRsvpSettings.service, guestRegistration.service). Runs against the
 * LOCAL database, no server needed:
 *
 *   node tests/rsvp-food-preference.test.js
 *
 * It borrows one guest who has not answered yet, answers for them, and then
 * puts the guest, the event's settings and the rows the answer wrote
 * (response log, the host's notification) back as they were.
 */
require('dotenv').config();
const m = require('../src/models');
const settingsService = require('../src/services/clientRsvpSettings.service');
const registration = require('../src/services/guestRegistration.service');

const { Op } = m.Sequelize;

const ok = (label, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
    if (!cond) process.exitCode = 1;
};
const fails = async (label, fn, text) => {
    try { await fn(); ok(label, false, '(did not throw)'); } catch (e) {
        ok(label, !text || e.message.includes(text), `-> ${e.message}`);
    }
};

const GUEST_FIELDS = [
    'response_type', 'rsvp_status', 'responded_at', 'party_size', 'plus_one', 'plus_one_count',
    'special_requirements', 'notes', 'dietary_preference', 'food_preference_option_id',
    'rsvp_side', 'relationship', 'relationship_option_id', 'participant_client_id',
];

(async () => {
    ok('the default is OFF', settingsService.DEFAULTS.allow_food_preference === false
        && settingsService.settingsOf({ rsvp_settings: null }).allow_food_preference === false);
    ok('a stored value is read', settingsService.settingsOf({ rsvp_settings: { allow_food_preference: true } })
        .allow_food_preference === true);

    /*
      A joined guest on an event whose RSVP is open. One who has not answered
      is rare in a dev database, so a guest who HAS is borrowed too: their
      answer is set aside (and put back at the end) so the form opens.
    */
    const candidates = await m.EventParticipant.findAll({
        where: { participant_client_id: { [Op.ne]: null } },
        order: [['id', 'DESC']],
        limit: 60,
    });
    let guest = null; let event = null; let before = null;
    for (const g of candidates) {
        /* eslint-disable no-await-in-loop */
        const e = await m.Event.findByPk(g.event_id);
        if (!e || Number(e.website_client_id) === Number(g.participant_client_id)) continue;
        const kept = Object.fromEntries(GUEST_FIELDS.map((f) => [f, g[f]]));
        await m.EventParticipant.update({ response_type: 'none' }, { where: { id: g.id } });
        const probe = await registration.getMyRsvp(g.participant_client_id, e.id).catch(() => null);
        if (probe && probe.can_respond) { guest = g; event = e; before = kept; break; }
        await m.EventParticipant.update(kept, { where: { id: g.id } });
        /* eslint-enable no-await-in-loop */
    }
    if (!guest) { console.log('SKIP  no joined guest on an event with RSVP open locally'); return; }

    const clientId = guest.participant_client_id;
    const savedSettings = event.rsvp_settings;
    const startedAt = new Date(Date.now() - 1000);
    console.log(`event ${event.id} guest ${guest.id} client ${clientId}`);

    try {
        // ── off: not offered, and ignored if sent ──
        await settingsService.update(event.website_client_id, event.id, { allow_food_preference: false });
        const off = await registration.getMyRsvp(clientId, event.id);
        ok('off -> the form is told so, and gets no options',
            off.settings.allow_food_preference === false && off.food_preference_options.length === 0);

        // ── on: offered ──
        const saved = await settingsService.update(event.website_client_id, event.id, { allow_food_preference: true });
        ok('the organizer switches it on', saved.settings.allow_food_preference === true);
        const on = await registration.getMyRsvp(clientId, event.id);
        ok('on -> the form is told so', on.settings.allow_food_preference === true);
        ok('on -> the options are listed', Array.isArray(on.food_preference_options),
            `(${on.food_preference_options.length} options)`);

        if (!on.food_preference_options.length) {
            console.log('SKIP  this event\'s category has no food preference options to pick from');
            return;
        }
        const pick = on.food_preference_options[0];

        await fails('an option that is not on the list is refused',
            () => registration.submitMyRsvp(clientId, event.id, {
                response_type: on.settings.response_options[0], food_preference_option_id: 99999999,
            }), 'food preference');
        ok('...and nothing was saved by the refusal',
            (await m.EventParticipant.findByPk(guest.id)).response_type === 'none');

        const answered = await registration.submitMyRsvp(clientId, event.id, {
            response_type: on.settings.response_options[0],
            party_size: 1,
            food_preference_option_id: pick.id,
        });
        const row = await m.EventParticipant.findByPk(guest.id);
        ok('the answer saves the option and its name',
            Number(row.food_preference_option_id) === Number(pick.id) && row.dietary_preference === pick.name,
            `${row.food_preference_option_id} / ${row.dietary_preference}`);
        ok('...and the form reads it back',
            Number(answered.rsvp.food_preference_option_id) === Number(pick.id)
            && answered.rsvp.dietary_preference === pick.name);
    } finally {
        await m.EventParticipant.update(before, { where: { id: guest.id } });
        await m.Event.update({ rsvp_settings: savedSettings }, { where: { id: event.id } });
        if (m.EventParticipantResponseLog) {
            await m.EventParticipantResponseLog.destroy({
                where: { participant_id: guest.id, created_at: { [Op.gte]: startedAt } },
            }).catch(() => {});
        }
        await m.ClientNotification.destroy({
            where: { event_id: event.id, participant_id: guest.id, created_at: { [Op.gte]: startedAt } },
        }).catch(() => {});
        const back = await m.EventParticipant.findByPk(guest.id);
        ok('cleanup: the guest has their own answer back', back.response_type === before.response_type
            && back.dietary_preference === before.dietary_preference);
    }
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; }).finally(() => m.sequelize.close());
