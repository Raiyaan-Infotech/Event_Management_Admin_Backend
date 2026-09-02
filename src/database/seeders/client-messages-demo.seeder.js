/**
 * Demo data for the Messages module and the notification feed.
 *
 *   node src/database/seeders/client-messages-demo.seeder.js
 *   node src/database/seeders/client-messages-demo.seeder.js --clear
 *   node src/database/seeders/client-messages-demo.seeder.js --email you@example.com
 *   node src/database/seeders/client-messages-demo.seeder.js --prod --email you@example.com --apply
 *
 * ── ⚠ IT WRITES TO EXACTLY ONE ACCOUNT, NAMED BY EMAIL ──────────────────────
 * Production has real people's accounts on it. A seeder that loops over every
 * client would put invented weddings and invented guests on somebody else's
 * login, and they would have no way to tell which of it was theirs.
 *
 * So `--email` is REQUIRED against production, the account is resolved before
 * anything is written, and the run prints whose it is and waits for `--apply`.
 * Locally it defaults to the seeded test client.
 *
 * ── EVERYTHING IT WRITES IS MARKED, SO --clear CAN BE EXACT ─────────────────
 * Guests carry `notes = 'msg-demo'`, campaigns carry a `[demo]` suffix in
 * `failed_reason`, notifications carry `meta.demo = true`. `--clear` removes
 * rows bearing those marks and nothing else — it never deletes by client id,
 * because that would take real rows with it.
 *
 * ── THE CAMPAIGNS ARE 'sending', NOT 'sent' ─────────────────────────────────
 * Same rule the live code follows. No provider is connected, so nothing has
 * left; demo rows that claimed `sent` and `delivered` would make the Messages
 * screen prove the exact thing the screen is careful not to claim, and the
 * first person to read the dashboard would believe it.
 *
 * Deliveries are written `queued` for the same reason.
 */
require('dotenv').config();
const path = require('path');

const PROD = process.argv.includes('--prod');
const CLEAR = process.argv.includes('--clear');
const APPLY = process.argv.includes('--apply');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const db = require('../../models');
const {
    sequelize, WebsiteClient, Event, EventGuest, EventGuestGroup,
    EventMessage, EventMessageCampaign, ClientNotification,
} = db;

const GUEST_MARK = 'msg-demo';
const CAMPAIGN_MARK = '[demo]';

const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};

const EMAIL = argValue('--email') || (PROD ? null : 'test@example.com');

/**
 * Deterministic PRNG — a reseeded run produces the same list, so screenshots
 * and numbers do not shift underfoot between runs.
 */
let seed = 20260901;
const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const intBetween = (a, b) => a + Math.floor(rand() * (b - a + 1));

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

const FIRST = ['Aditi', 'Rahul', 'Priya', 'Arjun', 'Kavya', 'Vikram', 'Sneha', 'Rohan',
    'Meera', 'Karan', 'Ananya', 'Siddharth', 'Divya', 'Nikhil', 'Pooja', 'Aman',
    'Riya', 'Varun', 'Neha', 'Aakash', 'Ishaan', 'Tara'];
const LAST = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Patel', 'Reddy', 'Gupta', 'Menon',
    'Kulkarni', 'Bose', 'Desai', 'Rao'];

const GROUPS = [
    { name: 'Family', color: '#EC4899' },
    { name: 'Close Friends', color: '#8B5CF6' },
    { name: 'Colleagues', color: '#3B82F6' },
];

/**
 * The campaign bodies keep their merge fields UNSUBSTITUTED, exactly as a real
 * send stores them — that is what makes a campaign re-sendable to a different
 * audience, and what the detail screen renders against a real recipient.
 */
const CAMPAIGNS = [
    {
        channel: 'whatsapp', kind: 'invite', hours: 96,
        subject: 'You are invited to {event_name}',
        body: 'Hi {first_name},\n\nYou are invited to our special day!\n'
            + 'Date: {event_date}\nTime: {event_time}\nVenue: {venue_name}\n\n'
            + 'Please RSVP by {rsvp_link}.\n\nLooking forward to celebrating with you!',
    },
    {
        channel: 'email', kind: 'invite', hours: 72,
        subject: 'Invitation — {event_name}',
        body: 'Dear {first_name},\n\nWe would love to celebrate this wonderful occasion '
            + 'with you at {venue_name} on {event_date}.\n\nWarm regards.',
    },
    {
        channel: 'whatsapp', kind: 'reminder', hours: 30,
        subject: 'Reminder: RSVP for {event_name}',
        body: 'Hi {first_name}, just a gentle reminder to RSVP for {event_name} on {event_date}.',
    },
    {
        channel: 'email', kind: 'update', hours: 8,
        subject: 'Venue and parking details',
        body: 'Hi {first_name}, here are the parking and venue details for {event_name}.',
    },
];

/* ── Which account ───────────────────────────────────────────────────────── */

async function resolveClient() {
    if (!EMAIL) {
        throw new Error(
            'Against production you must name the account: --email you@example.com\n'
            + '        A seeder that guessed would put invented data on somebody else’s login.',
        );
    }
    const client = await WebsiteClient.findOne({ where: { email: EMAIL } });
    if (!client) throw new Error(`No client with email ${EMAIL} on ${PROD ? 'PRODUCTION' : 'LOCAL'}.`);
    return client;
}

/* ── Clear ───────────────────────────────────────────────────────────────── */

async function clear(client) {
    // Order matters: deliveries FK to both campaigns and guests.
    const campaigns = await EventMessageCampaign.findAll({
        where: {
            website_client_id: client.id,
            failed_reason: { [db.Sequelize.Op.like]: `%${CAMPAIGN_MARK}%` },
        },
        attributes: ['id'],
        paranoid: false,
    });
    const campaignIds = campaigns.map((c) => c.id);

    const guests = await EventGuest.findAll({
        where: { website_client_id: client.id, notes: GUEST_MARK },
        attributes: ['id'],
        paranoid: false,
    });
    const guestIds = guests.map((g) => g.id);

    let msgs = 0;
    if (campaignIds.length) {
        msgs += await EventMessage.destroy({ where: { campaign_id: campaignIds }, force: true });
    }
    if (guestIds.length) {
        msgs += await EventMessage.destroy({ where: { guest_id: guestIds }, force: true });
    }
    const camps = campaignIds.length
        ? await EventMessageCampaign.destroy({ where: { id: campaignIds }, force: true })
        : 0;
    const gone = guestIds.length
        ? await EventGuest.destroy({ where: { id: guestIds }, force: true })
        : 0;

    /*
      Notifications are matched on their own mark, not on the client — the feed
      also holds rows a real action wrote, and those must survive a --clear.
    */
    const notes = await sequelize.query(
        `DELETE FROM client_notifications
          WHERE website_client_id = :id
            AND JSON_EXTRACT(meta, '$.demo') = true`,
        { replacements: { id: client.id } },
    );

    const groups = await EventGuestGroup.destroy({
        where: {
            website_client_id: client.id,
            description: `${GUEST_MARK} group`,
        },
        force: true,
    });

    console.log(`  removed ${camps} campaigns, ${msgs} deliveries, ${gone} guests, `
        + `${groups} groups, ${notes[0]?.affectedRows ?? 0} notifications`);
}

/* ── Seed ────────────────────────────────────────────────────────────────── */

async function seedFor(client) {
    /*
      A message needs an event and an event needs guests. Rather than inventing
      an event on somebody's account, this uses one they already have — and only
      creates one when there is none at all.
    */
    let events = await Event.findAll({
        where: { website_client_id: client.id },
        order: [['id', 'ASC']],
    });

    if (!events.length) {
        const created = await Event.create({
            website_client_id: client.id,
            company_id: client.company_id ?? 1,
            name: 'Demo Wedding',
            start_date: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
            start_time: '18:00:00',
            venue_name: 'The Grand Palace',
            venue_address: 'Delhi',
            status: 'upcoming',
            privacy: 'private',
        });
        console.log(`  + created event "${created.name}" (there were none)`);
        events = [created];
    }

    const event = events.find((e) => e.status !== 'draft') || events[0];
    console.log(`  using event #${event.id} "${event.name}"`);

    // Groups, only the ones missing.
    const groupRows = [];
    for (const g of GROUPS) {
        const [row] = await EventGuestGroup.findOrCreate({
            where: { website_client_id: client.id, name: g.name },
            defaults: {
                website_client_id: client.id,
                company_id: client.company_id ?? 1,
                name: g.name,
                color: g.color,
                description: `${GUEST_MARK} group`,
                visibility: 'private',
            },
        });
        groupRows.push(row);
    }

    // Guests. Everyone gets an email; ~15% deliberately have no phone number, so
    // the "skipped" count on the WhatsApp send is a real number and not zero.
    const guests = [];
    const stamp = Date.now();
    for (let i = 0; i < 36; i += 1) {
        const first = pick(FIRST);
        const last = pick(LAST);
        const hasPhone = rand() > 0.15;
        guests.push({
            event_id: event.id,
            website_client_id: client.id,
            company_id: client.company_id ?? 1,
            group_id: pick(groupRows).id,
            name: `${first} ${last}`,
            first_name: first,
            last_name: last,
            email: `${first}.${last}.${stamp}.${i}`.toLowerCase() + '@example.com',
            dial_code: '+91',
            mobile: hasPhone ? `9${intBetween(100000000, 999999999)}` : null,
            table_number: String(intBetween(1, 14)),
            party_size: rand() > 0.65 ? intBetween(2, 4) : 1,
            rsvp_status: 'invited',
            invite_source: 'whatsapp',
            /*
              Before the EARLIEST campaign (96h), so no message can appear to
              have been sent before the invitation went out. The RSVP timeline
              sorts strictly by time and shows that inconsistency immediately.
            */
            invited_at: hoursAgo(intBetween(100, 125)),
            /*
              ⚠ Set explicitly, and always BEFORE `invited_at`. Left to default
              it becomes NOW, which puts "added to the guest list" after the
              messages that were sent to them — an impossible order that made
              the RSVP timeline read as nonsense.
            */
            created_at: hoursAgo(intBetween(130, 200)),
            notes: GUEST_MARK,
        });
    }
    const created = await EventGuest.bulkCreate(guests);
    console.log(`  + ${created.length} guests`);

    // Campaigns and their deliveries.
    let deliveries = 0;
    const notifications = [];

    for (const c of CAMPAIGNS) {
        // Only guests reachable on that channel — the same rule the live send
        // applies, so the demo numbers reconcile the way real ones would.
        const reachable = created.filter((g) => (c.channel === 'email' ? g.email : g.mobile));

        const campaign = await EventMessageCampaign.create({
            website_client_id: client.id,
            event_id: event.id,
            subject: c.subject,
            body: c.body,
            channel: c.channel,
            kind: c.kind,
            audience: 'all',
            recipients_count: reachable.length,
            // NOT 'sent'. Nothing has left this system.
            status: 'sending',
            sent_at: hoursAgo(c.hours),
            failed_reason: `${c.channel === 'email' ? 'Email' : 'WhatsApp'} is not connected yet. `
                + `Recorded, not delivered. ${CAMPAIGN_MARK}`,
            created_at: hoursAgo(c.hours),
        });

        await EventMessage.bulkCreate(reachable.map((g) => ({
            event_id: event.id,
            campaign_id: campaign.id,
            guest_id: g.id,
            website_client_id: client.id,
            channel: c.channel,
            kind: c.kind === 'custom' ? 'update' : c.kind,
            // 'queued', for the same reason as above.
            status: 'queued',
            sent_at: hoursAgo(c.hours),
        })));
        deliveries += reachable.length;

        notifications.push({
            website_client_id: client.id,
            company_id: client.company_id ?? 1,
            category: 'system',
            type: 'campaign_sent',
            title: `${c.channel === 'email' ? 'Email' : 'WhatsApp'} message sent`,
            body: `"${c.subject}" was recorded for ${reachable.length} guests on ${event.name}.`,
            event_id: event.id,
            link: `/dashboard/messages/${campaign.id}`,
            meta: { demo: true, channel: c.channel, recipients: reachable.length },
            is_read: c.hours > 48,
            read_at: c.hours > 48 ? hoursAgo(c.hours - 2) : null,
            created_at: hoursAgo(c.hours),
        });

        console.log(`  + campaign "${c.subject.slice(0, 34)}…" (${c.channel}, ${reachable.length})`);
    }

    /*
      A few RSVPs, so the feed has something in every tab rather than four
      identical System rows. The guest row is updated to match — a notification
      saying somebody accepted, beside a guest who never did, is the kind of
      inconsistency that makes people distrust the whole screen.
    */
    const responders = created.slice(0, 6);
    for (let i = 0; i < responders.length; i += 1) {
        const g = responders[i];
        const yes = i % 3 !== 2;
        await g.update({
            response_type: yes ? 'yes' : 'no',
            rsvp_status: yes ? 'accepted' : 'declined',
            responded_at: hoursAgo(intBetween(2, 40)),
        });
        notifications.push({
            website_client_id: client.id,
            company_id: client.company_id ?? 1,
            category: 'rsvp',
            type: yes ? 'rsvp_accepted' : 'rsvp_declined',
            title: 'New RSVP received',
            body: `${g.name} ${yes ? 'accepted' : 'declined'} your invitation.`,
            event_id: event.id,
            guest_id: g.id,
            link: `/dashboard/guests/${g.id}`,
            meta: { demo: true, response: yes ? 'yes' : 'no' },
            is_read: i > 3,
            created_at: hoursAgo(intBetween(2, 40)),
        });
    }

    // One of each remaining category, so every tab has content.
    notifications.push(
        {
            website_client_id: client.id,
            company_id: client.company_id ?? 1,
            category: 'guest',
            type: 'guest_added',
            title: 'New guests added',
            body: `${created.length} guests were added to ${event.name}.`,
            event_id: event.id,
            link: '/dashboard/guests',
            meta: { demo: true },
            is_read: false,
            created_at: hoursAgo(126),
        },
        {
            website_client_id: client.id,
            company_id: client.company_id ?? 1,
            category: 'reminder',
            type: 'event_reminder',
            title: 'Event coming up',
            body: `${event.name} is on ${event.start_date}. ${created.length} guests have been invited.`,
            event_id: event.id,
            link: `/dashboard/events/${event.id}`,
            meta: { demo: true },
            is_read: false,
            created_at: hoursAgo(4),
        },
    );

    await ClientNotification.bulkCreate(notifications);
    console.log(`  + ${deliveries} deliveries, ${notifications.length} notifications`);
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);

    const client = await resolveClient();
    console.log(`Account: #${client.id}  ${client.name}  <${client.email}>\n`);

    try {
        if (CLEAR) {
            if (PROD && !APPLY) {
                console.log('  DRY RUN — add --apply to actually remove.\n');
                return;
            }
            await clear(client);
            console.log('\n  cleared\n');
            return;
        }

        // Idempotent: a second run without --clear would double everything.
        const existing = await EventGuest.count({
            where: { website_client_id: client.id, notes: GUEST_MARK },
        });
        if (existing > 0) {
            console.log(`  ${existing} demo guests already present — run with --clear first to reseed.\n`);
            return;
        }

        if (PROD && !APPLY) {
            console.log('  DRY RUN — this would seed guests, 4 campaigns and a notification feed');
            console.log(`  onto the account above. Add --apply to write.\n`);
            return;
        }

        await seedFor(client);
        console.log('\n  seeded\n');
    } finally {
        await sequelize.close();
    }
})().catch((e) => { console.error('\nFAILED:', e.message, '\n'); process.exit(1); });
