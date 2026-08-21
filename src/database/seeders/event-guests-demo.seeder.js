/**
 * Demo guests and messages for the local client portal.
 *
 * The Analytics screen reads real tables now, and real tables start empty — so
 * every chart rendered as a zero until something was in them. This fills the
 * existing demo events with a plausible guest list and message log so the
 * screen can be looked at.
 *
 * LOCAL ONLY, and it refuses to run against production. Seeded rows are marked
 * with `notes = 'demo-seed'` so `--clear` can remove exactly them and nothing
 * a real user entered.
 *
 *   node src/database/seeders/event-guests-demo.seeder.js           seed
 *   node src/database/seeders/event-guests-demo.seeder.js --clear   remove only demo-seed rows
 */
require('dotenv').config();

if (process.argv.includes('prod')) {
    console.error('This script is local-only. Refusing to run against production.');
    process.exit(1);
}

const { Event, EventGuest, EventMessage, sequelize } = require('../../models');

const CLEAR = process.argv.includes('--clear');
const MARK = 'demo-seed';

const FIRST = ['Aditi', 'Rahul', 'Priya', 'Arjun', 'Kavya', 'Vikram', 'Sneha', 'Rohan', 'Meera', 'Karan',
    'Ananya', 'Siddharth', 'Divya', 'Nikhil', 'Pooja', 'Aman', 'Riya', 'Varun', 'Neha', 'Aakash'];
const LAST = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Patel', 'Reddy', 'Gupta', 'Menon', 'Kulkarni', 'Bose'];

/** Deterministic PRNG — a reseeded run produces the same list, so screenshots
 *  and numbers do not shift underfoot between runs. */
let seed = 20260820;
const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const intBetween = (a, b) => a + Math.floor(rand() * (b - a + 1));

const daysAgo = (n, jitterHours = 12) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(intBetween(9, 21), intBetween(0, 59), 0, 0);
    if (jitterHours) d.setMinutes(d.getMinutes() + intBetween(-jitterHours * 60, jitterHours * 60));
    return d;
};

(async () => {
    const events = await Event.findAll({ order: [['id', 'ASC']] });
    if (events.length === 0) {
        console.error('No events found. Create some first.');
        process.exit(1);
    }

    if (CLEAR) {
        // Messages first — they FK to guests.
        const guestIds = (await EventGuest.findAll({ where: { notes: MARK }, attributes: ['id'] })).map((g) => g.id);
        const msgs = guestIds.length
            ? await EventMessage.destroy({ where: { guest_id: guestIds }, force: true })
            : 0;
        const gone = await EventGuest.destroy({ where: { notes: MARK }, force: true });
        console.log(`removed ${gone} demo guests and ${msgs} demo messages`);
        await sequelize.close();
        return;
    }

    const existing = await EventGuest.count({ where: { notes: MARK } });
    if (existing > 0) {
        console.log(`${existing} demo guests already present — run with --clear first to reseed.`);
        await sequelize.close();
        return;
    }

    let totalGuests = 0;
    let totalMessages = 0;

    for (const event of events) {
        // A draft has not been sent to anyone yet: no guests, no messages. That
        // is the honest shape, and it is what makes the Draft row on My Events
        // show dashes rather than numbers.
        if (event.status === 'draft') {
            console.log(`  ${event.name.padEnd(26)} skipped (draft)`);
            continue;
        }

        const count = intBetween(24, 60);
        const guestRows = [];
        const messageRows = [];

        for (let i = 0; i < count; i += 1) {
            const name = `${pick(FIRST)} ${pick(LAST)}`;
            const source = chance(0.49) ? 'whatsapp' : chance(0.6) ? 'email' : chance(0.7) ? 'sms' : 'manual';
            const invitedAt = daysAgo(intBetween(2, 28));

            // Roughly the design's mix: 60% attending, 24% not, 10% maybe, 6% silent.
            const roll = rand();
            const status = roll < 0.6 ? 'attending' : roll < 0.84 ? 'not_attending' : roll < 0.94 ? 'maybe' : 'no_response';
            const responded = status !== 'no_response';
            const respondedAt = responded
                ? new Date(invitedAt.getTime() + intBetween(1, 96) * 3600 * 1000)
                : null;

            guestRows.push({
                event_id: event.id,
                website_client_id: event.website_client_id,
                company_id: event.company_id,
                name,
                email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
                dial_code: '+91',
                mobile: `9${intBetween(100000000, 999999999)}`,
                party_size: chance(0.35) ? intBetween(2, 4) : 1,
                rsvp_status: status,
                invite_source: source,
                invited_at: invitedAt,
                // Never in the future, and never before the invite went out.
                responded_at: respondedAt && respondedAt <= new Date() ? respondedAt : null,
                notes: MARK,
            });
        }

        const created = await EventGuest.bulkCreate(guestRows);
        totalGuests += created.length;

        for (const guest of created) {
            // 'manual' guests were added by hand and never messaged — which is
            // what keeps delivery rates below 100% honestly.
            if (guest.invite_source === 'manual') continue;

            const channel = guest.invite_source;
            const sentAt = guest.invited_at;
            const deliveredOk = chance(0.97);
            const deliveredAt = deliveredOk ? new Date(sentAt.getTime() + intBetween(1, 90) * 1000) : null;

            // SMS reports neither opens nor clicks — no pixel, no link wrapper.
            const trackable = channel !== 'sms';
            const openedAt = deliveredOk && trackable && chance(0.68)
                ? new Date(deliveredAt.getTime() + intBetween(60, 86400) * 1000)
                : null;
            const clickedAt = openedAt && chance(0.35)
                ? new Date(openedAt.getTime() + intBetween(10, 3600) * 1000)
                : null;

            messageRows.push({
                event_id: event.id,
                guest_id: guest.id,
                website_client_id: event.website_client_id,
                channel,
                kind: 'invite',
                status: deliveredOk ? 'delivered' : 'failed',
                sent_at: sentAt,
                delivered_at: deliveredAt,
                opened_at: openedAt,
                clicked_at: clickedAt,
                failed_reason: deliveredOk ? null : 'Number not reachable',
            });
        }

        await EventMessage.bulkCreate(messageRows);
        totalMessages += messageRows.length;
        console.log(`  ${event.name.padEnd(26)} ${created.length} guests, ${messageRows.length} messages`);
    }

    console.log(`\nseeded ${totalGuests} guests and ${totalMessages} messages`);
    await sequelize.close();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
