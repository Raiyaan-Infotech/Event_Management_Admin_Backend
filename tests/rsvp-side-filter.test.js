/*
 * RSVP list — the Groom / Bride side and relation filters, through the service.
 *
 * Creates four temporary participants on one real event (two groom, one bride,
 * one with no side), checks the filters, and deletes them again.
 *   node tests/rsvp-side-filter.test.js
 * Needs the local DB and at least one event.
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize, Event, EventParticipant } = require('../src/models');
const rsvp = require('../src/services/clientRsvp.service');

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

(async () => {
    const event = await Event.findOne({ attributes: ['id', 'website_client_id'] });
    if (!event) { console.log('SKIP  no event on this database'); process.exit(0); }
    const client = event.website_client_id;
    const made = [];
    const mk = async (name, side, relationship) => {
        const row = await EventParticipant.create({
            event_id: event.id, website_client_id: client, name: `ZZ ${name}`,
            rsvp_status: 'invited', response_type: 'none', invite_source: 'manual',
            rsvp_side: side, relationship,
        });
        made.push(row.id);
        return row;
    };

    try {
        await mk('Groom Father', 'groom', 'ZZ Father');
        await mk('Groom Friend', 'groom', 'ZZ Friend');
        await mk('Bride Father', 'bride', 'ZZ Father');
        await mk('No Side', null, null);

        const q = (extra) => rsvp.list(client, { event_id: event.id, search: 'ZZ', limit: 100, ...extra });
        const all = await q({});
        const groom = await q({ side: 'groom' });
        const bride = await q({ side: 'bride' });
        const father = await q({ relationship: 'ZZ Father' });
        const groomFather = await q({ side: 'groom', relationship: 'ZZ Father' });

        ok('no filter lists all four', all.rsvps.length === 4, `${all.rsvps.length}`);
        ok('side=groom lists the two groom rows', groom.rsvps.length === 2 && groom.rsvps.every((r) => r.rsvp_side === 'groom'));
        ok('side=bride lists the one bride row', bride.rsvps.length === 1 && bride.rsvps[0].rsvp_side === 'bride');
        ok('relationship filter lists that relation on both sides', father.rsvps.length === 2
            && father.rsvps.every((r) => r.guest.relationship === 'ZZ Father'));
        ok('side + relationship combine', groomFather.rsvps.length === 1 && groomFather.rsvps[0].guest.name === 'ZZ Groom Father');
        ok('tiles follow the side filter', groom.stats.total_invitations === 2, `${groom.stats.total_invitations}`);
        ok('an unknown side is ignored, not an error', (await q({ side: 'x' })).rsvps.length === 4);
        ok('"all" relationship is no filter', (await q({ relationship: 'all' })).rsvps.length === 4);
        ok('the row carries side and relation for the screens',
            groom.rsvps.every((r) => 'rsvp_side' in r && 'relationship' in r.guest));
    } finally {
        if (made.length) await EventParticipant.destroy({ where: { id: { [Op.in]: made } }, force: true });
        await sequelize.close();
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await sequelize.close(); } catch { /* ignore */ } process.exit(1); });
