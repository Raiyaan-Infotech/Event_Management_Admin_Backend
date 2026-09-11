/**
 * Showcase data: polished events, each with an active splash and a guest list,
 * so the client portal and the mobile app have something that looks like a real
 * account rather than "Demo Wedding" with nothing behind it.
 *
 *   node src/database/seeders/showcase-events.seeder.js --email you@example.com
 *   node src/database/seeders/showcase-events.seeder.js --prod --email you@example.com          (dry run)
 *   node src/database/seeders/showcase-events.seeder.js --prod --email you@example.com --apply
 *   node src/database/seeders/showcase-events.seeder.js --prod --email you@example.com --clear --apply
 *
 * ── ⚠ ONE ACCOUNT, NAMED BY EMAIL, AND NOTHING WRITTEN WITHOUT --apply ──────
 * Same rule as splash-screens-demo.seeder.js: production carries real people's
 * accounts, so `--email` is required there and the run prints whose account it
 * is before touching anything.
 *
 * ── THROUGH THE REAL SERVICES, NOT RAW INSERTS ──────────────────────────────
 * Events go through `clientEvent.service.createEvent`, so they are validated
 * against the account's PLAN exactly like the portal wizard (category, type,
 * religion, menus must be granted) and get a real QR token. Splashes go through
 * `clientSplashScreen.service`, so the one-splash-per-event rule and the event
 * name copy apply. Nothing here can create an event the portal could not.
 *
 * ⚠ QR tokens are encrypted with the EVENT_QR_SECRET of the environment this
 * runs against. Against production that is `.env.production` — verified to be
 * the key the live server uses (it decrypts a live-issued token).
 *
 * ── WHAT --clear REMOVES ────────────────────────────────────────────────────
 * The events whose names are in SHOWCASE below on this account (with their
 * guests and splashes), and any splash named "[Showcase] …" — e.g. the one this
 * adds to an existing event. Nothing else.
 *
 * ── MEDIA ───────────────────────────────────────────────────────────────────
 * Splash photos are the Unsplash images already vetted for
 * splash-screens-demo.seeder.js (downloaded and viewed before use). They are
 * stand-ins until the account uploads its own.
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

// Models and services AFTER the env is settled — they read it on load.
const db = require('../../models');
const eventService = require('../../services/clientEvent.service');
const portalService = require('../../services/clientPortal.service');
const splashService = require('../../services/clientSplashScreen.service');

const { sequelize, WebsiteClient, Event, EventGuest, SplashScreen, Sequelize } = db;
const { Op } = Sequelize;

const SPLASH_MARK = '[Showcase] ';

const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};
const EMAIL = argValue('--email') || (PROD ? null : 'test@example.com');

/* ── The content ─────────────────────────────────────────────────────────── */

const IMG = {
    banquet: 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1080&q=70',
    couple: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1080&q=70',
    rings: 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=600&h=600&fit=crop&q=70',
    chairs: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=1080&q=70',
};

const SHOWCASE = [
    {
        event: {
            name: 'Ayaan & Zara — Nikah',
            host_one: 'Ayaan Rahman',
            host_two: 'Zara Khan',
            tagline: 'Two souls, one prayer',
            description:
                'With the blessings of Allah and our families, we invite you to witness the Nikah of '
                + 'Ayaan and Zara. Your presence and duas will make our day complete. '
                + 'The ceremony will be followed by dinner.',
            start_date: '2026-11-21', end_date: '2026-11-21',
            start_time: '17:30', end_time: '21:30',
            venue_name: 'ITC Grand Chola',
            venue_address: 'No. 63, Mount Road, Guindy, Chennai, Tamil Nadu 600032',
            organizer: 'The Rahman & Khan Families',
            footer_note: 'With duas and love',
            primary_color: '#0F766E',
        },
        splash: {
            main_title: "YOU'RE INVITED",
            sub_title: 'To the Nikah of',
            tagline: 'Two souls, one prayer',
            background_type: 'couple_photo',
            background_url: IMG.couple,
            background_config: { fit: 'cover', overlay: 45, dark_overlay: true },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#FDE68A', size: 60 },
            button_text: 'Enter Invitation', button_style: 'filled', button_color: '#0F766E',
        },
        guests: 10,
    },
    {
        event: {
            name: 'Imran & Sana — Walima Reception',
            host_one: 'Imran Siddiqui',
            host_two: 'Sana Farooqui',
            tagline: 'An evening of joy and gratitude',
            description:
                'Join us for the Walima of Imran and Sana — an evening of good food, family and '
                + 'gratitude as we begin our new life together.',
            start_date: '2026-12-06', end_date: '2026-12-06',
            start_time: '19:00', end_time: '23:00',
            venue_name: 'Taj Falaknuma Palace',
            venue_address: 'Engine Bowli, Falaknuma, Hyderabad, Telangana 500053',
            organizer: 'The Siddiqui Family',
            footer_note: 'Dinner will be served',
            primary_color: '#B45309',
        },
        splash: {
            main_title: 'WALIMA',
            sub_title: 'Reception',
            tagline: 'An evening of joy and gratitude',
            background_type: 'image',
            background_url: IMG.banquet,
            background_config: { overlay: 40 },
            loader_enabled: true,
            loader_config: { style: 'ring', color: '#FBBF24', size: 55 },
            button_text: 'View Invitation', button_style: 'outline', button_color: '#FBBF24',
        },
        guests: 12,
    },
    {
        event: {
            name: 'Faisal & Noor — Mehendi Night',
            host_one: 'Faisal Ahmed',
            host_two: 'Noor Fathima',
            tagline: 'Henna, music and a night to remember',
            description:
                'Celebrate the Mehendi night of Faisal and Noor with music, henna and loved ones — '
                + 'the start of our wedding festivities.',
            start_date: '2027-01-15', end_date: '2027-01-15',
            start_time: '18:00', end_time: '22:30',
            venue_name: 'The Leela Palace',
            venue_address: 'Adyar Seaface, MRC Nagar, Chennai, Tamil Nadu 600028',
            organizer: 'The Ahmed Family',
            footer_note: 'Dress code: shades of green',
            primary_color: '#15803D',
        },
        splash: {
            main_title: 'MEHENDI NIGHT',
            sub_title: 'Celebrating',
            tagline: 'Henna, music and a night to remember',
            background_type: 'gradient',
            background_config: { gradient_type: 'linear', color_1: '#064E3B', color_2: '#CA8A04' },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#FFFFFF', size: 60 },
            button_text: 'Join the Celebration', button_style: 'filled', button_color: '#CA8A04',
        },
        guests: 8,
    },
];

/** A splash for an event the account already has, if it has none. */
const EXISTING_EVENT_SPLASH = {
    main_title: 'SAVE THE DATE',
    sub_title: 'For the wedding of',
    tagline: 'Forever begins here',
    background_type: 'couple_photo',
    background_url: IMG.chairs,
    background_config: { fit: 'cover', overlay: 40, dark_overlay: true },
    loader_enabled: true,
    loader_config: { style: 'dots', color: '#F9A8D4', size: 60 },
    button_text: 'Enter Invitation', button_style: 'filled', button_color: '#DB2777',
};

const FIRST = ['Aamir', 'Fatima', 'Yusuf', 'Ayesha', 'Hamza', 'Mariam', 'Bilal', 'Hina', 'Rehan', 'Sara',
    'Arif', 'Nazia', 'Zaid', 'Iqra', 'Salman', 'Rukhsar'];
const LAST = ['Shaikh', 'Qureshi', 'Ansari', 'Hussain', 'Pathan', 'Mirza', 'Syed', 'Baig'];
const RELATIONS = ['Family', 'Cousin', 'Uncle', 'Aunt', 'Friend', 'Colleague', 'Neighbour', 'Family Friend'];

/* ── Helpers ─────────────────────────────────────────────────────────────── */

async function resolveClient() {
    if (!EMAIL) {
        throw new Error('Against production you must name the account: --email you@example.com');
    }
    const client = await WebsiteClient.findOne({ where: { email: EMAIL } });
    if (!client) throw new Error(`No client with email ${EMAIL} on ${PROD ? 'PRODUCTION' : 'LOCAL'}.`);
    return client;
}

/** One event body, scoped to what the account's plan offers. */
function eventBody(item, options, client, templateCode) {
    const category = options.categories[0];
    const type = options.types.find((t) => !t.event_category_id || t.event_category_id === category.id);
    const religion = options.religions.find((r) =>
        (!r.event_category_id || r.event_category_id === category.id)
        && (!r.event_type_id || r.event_type_id === type?.id));

    return {
        ...item.event,
        event_category_id: category.id,
        event_type_id: type?.id,
        religion_id: religion ? religion.id : null,
        timezone: 'Asia/Kolkata',
        contact_email: client.email,
        contact_phone: client.mobile ? `+91 ${client.mobile}` : null,
        privacy: 'private',
        status: 'upcoming',
        menu_ids: options.menus.map((m) => m.id),
        theme_id: templateCode || null,
    };
}

function guestRows(event, client, count, offset) {
    return Array.from({ length: count }, (_, i) => {
        const first = FIRST[(i + offset) % FIRST.length];
        const last = LAST[(i * 3 + offset) % LAST.length];
        return {
            event_id: event.id,
            website_client_id: client.id,
            company_id: client.company_id ?? 1,
            name: `${first} ${last}`,
            first_name: first,
            last_name: last,
            email: `${first}.${last}.${event.id}@example.com`.toLowerCase(),
            dial_code: '+91',
            mobile: `9${String(100000000 + event.id * 1000 + i).slice(-9)}`,
            relationship: RELATIONS[(i + offset) % RELATIONS.length],
            party_size: 1 + ((i + offset) % 3),
            invite_source: 'manual',
            rsvp_status: 'not_responded',
            response_type: 'none',
        };
    });
}

async function clear(client) {
    const events = await Event.findAll({
        where: { website_client_id: client.id, name: { [Op.in]: SHOWCASE.map((s) => s.event.name) } },
        attributes: ['id', 'name'],
    });
    const ids = events.map((e) => e.id);

    // Splashes through the service: it unlinks event_id before the soft delete.
    const splashes = await SplashScreen.findAll({
        where: {
            website_client_id: client.id,
            [Op.or]: [{ name: { [Op.like]: `${SPLASH_MARK}%` } }, ...(ids.length ? [{ event_id: { [Op.in]: ids } }] : [])],
        },
        attributes: ['id'],
    });
    for (const s of splashes) await splashService.deleteSplashScreen(client.id, s.id);

    const guests = ids.length ? await EventGuest.destroy({ where: { event_id: { [Op.in]: ids } }, force: true }) : 0;
    const gone = ids.length ? await Event.destroy({ where: { id: { [Op.in]: ids } } }) : 0;
    console.log(`  removed ${gone} showcase event(s), ${guests} guest(s), ${splashes.length} splash screen(s)`);
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    try {
        const client = await resolveClient();
        console.log(`Account: #${client.id}  ${client.name}  <${client.email}>`);

        if (CLEAR) {
            if (PROD && !APPLY) { console.log('\n  DRY RUN — add --apply to remove.\n'); return; }
            await clear(client);
            return;
        }

        const options = await portalService.getEventOptions(client.id);
        if (!options.plan) throw new Error(options.reason || 'This account has no usable plan.');
        if (!options.categories.length) throw new Error('The plan offers no event category.');

        const templates = options.templates || [];
        console.log(`Plan:    ${options.plan.name}`);
        console.log(`Scope:   ${options.categories[0].name} / ${(options.types[0] || {}).name || '—'}`);
        console.log(`Menus:   ${options.menus.map((m) => m.slug).join(', ') || '(none)'}`);
        console.log(`Themes:  ${templates.map((t) => t.code).join(', ') || '(none — built-in fallback)'}\n`);

        const already = await Event.count({
            where: { website_client_id: client.id, name: { [Op.in]: SHOWCASE.map((s) => s.event.name) } },
        });
        if (already) {
            console.log(`  ${already} showcase event(s) already on this account — run with --clear first to reseed.\n`);
            return;
        }

        const existingNoSplash = await Event.findAll({
            where: {
                website_client_id: client.id,
                id: { [Op.notIn]: sequelize.literal('(SELECT event_id FROM splash_screens WHERE event_id IS NOT NULL AND deleted_at IS NULL)') },
            },
            attributes: ['id', 'name'],
            order: [['id', 'DESC']],
            limit: 1,
        });

        if (!APPLY && PROD) {
            SHOWCASE.forEach((s, i) => console.log(
                `  WOULD CREATE  ${s.event.name}  (${s.event.start_date}, ${s.event.venue_name}) `
                + `theme=${templates.length ? templates[i % templates.length].code : '—'}  `
                + `+ ${s.guests} guests + ${s.splash.background_type} splash`,
            ));
            if (existingNoSplash[0]) console.log(`  WOULD ADD     splash to existing event #${existingNoSplash[0].id} ${existingNoSplash[0].name}`);
            console.log('\n  DRY RUN — add --apply to write.\n');
            return;
        }

        for (const [i, item] of SHOWCASE.entries()) {
            const theme = templates.length ? templates[i % templates.length].code : null;
            const event = await eventService.createEvent(client.id, eventBody(item, options, client, theme));

            await EventGuest.bulkCreate(guestRows(event, client, item.guests, i * 5));

            const splash = await splashService.createSplashScreen(client.id, client.company_id, {
                ...item.splash,
                name: `${SPLASH_MARK}${item.event.name}`,
                event_id: event.id,
                show_couple_name: true,
                show_event_date: true,
                show_tagline: true,
                status: 'active',
            });
            console.log(`  + event #${event.id}  ${event.name}  theme=${event.theme_id || '—'}  qr=${event.qr_token ? 'yes' : 'no'}`
                + `  guests=${item.guests}  splash #${splash.id} (${splash.background_type})`);
        }

        if (existingNoSplash[0]) {
            const ev = existingNoSplash[0];
            const splash = await splashService.createSplashScreen(client.id, client.company_id, {
                ...EXISTING_EVENT_SPLASH,
                name: `${SPLASH_MARK}${ev.name}`,
                event_id: ev.id,
                show_couple_name: true,
                show_event_date: true,
                show_tagline: true,
                status: 'active',
            });
            console.log(`  + splash #${splash.id} (${splash.background_type}) on existing event #${ev.id} ${ev.name}`);
        }

        console.log('\n  seeded\n');
    } finally {
        await sequelize.close();
    }
})().catch((e) => { console.error('\nFAILED:', e.message, '\n'); process.exit(1); });
