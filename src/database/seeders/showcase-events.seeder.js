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
 *   A second content set, for an account known by its mobile number:
 *   node src/database/seeders/showcase-events.seeder.js --prod --set ismail --mobile 7010051951 --plan 1 --name Ismail
 *
 *   Three weddings that are past / happening now / upcoming whenever it runs,
 *   each with its own guest list and a real uploaded cover photo:
 *   node src/database/seeders/showcase-events.seeder.js --prod --set qa --mobile 9xxxxxxxxx --plan N --apply
 *
 * ── ⚠ ONE ACCOUNT, NAMED BY EMAIL OR MOBILE, NOTHING WRITTEN WITHOUT --apply ─
 * Same rule as splash-screens-demo.seeder.js: production carries real people's
 * accounts, so `--email` or `--mobile` is required there and the run prints
 * whose account it is before touching anything. A mobile that matches more than
 * one account is refused rather than guessed.
 *
 * `--plan <id>` and `--name <name>` change the ACCOUNT itself (an account with
 * no plan cannot create events). Both are printed in the dry run first.
 *
 * ── THROUGH THE REAL SERVICES, NOT RAW INSERTS ──────────────────────────────
 * Events go through `clientEvent.service.createEvent`, so they are validated
 * against the account's PLAN exactly like the portal wizard (category and
 * menus must be granted) and get a real QR token. Splashes go through
 * `clientSplashScreen.service`, so the one-splash-per-event rule and the event
 * name copy apply. Nothing here can create an event the portal could not.
 *
 * ⚠ QR tokens are encrypted with the EVENT_QR_SECRET of the environment this
 * runs against. Against production that is `.env.production` — verified to be
 * the key the live server uses (it decrypts a live-issued token).
 *
 * ── GUEST RESPONSES AND INVITE HISTORY (sets with `responses: true`) ────────
 * Guests get a spread of answers (accepted / declined / maybe / not yet) and
 * one `event_messages` row per invited guest with status sent or delivered, so
 * the RSVP page, guest list and "Invitations Sent" read like a real account.
 * Those rows are history only: nothing dispatches `event_messages` by status,
 * so no WhatsApp, SMS or email is sent. Guest numbers are 9xxxxxxxxx fillers
 * and emails are @example.com — never a real person.
 *
 * ── WHAT --clear REMOVES ────────────────────────────────────────────────────
 * The events whose names are in the chosen set on this account (with their
 * guests, invite history and splashes), and any splash named "[Showcase] …" —
 * e.g. the one this adds to an existing event. Nothing else; the plan and name
 * are left as they are.
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

const axios = require('axios');

// Models and services AFTER the env is settled — they read it on load.
const db = require('../../models');
const eventService = require('../../services/clientEvent.service');
const portalService = require('../../services/clientPortal.service');
const splashService = require('../../services/clientSplashScreen.service');
const mediaService = require('../../services/media.service');

const { sequelize, WebsiteClient, SubscriptionPlan, Event, EventParticipant, EventMessage, SplashScreen, Sequelize } = db;
const { Op } = Sequelize;

const SPLASH_MARK = '[Showcase] ';

const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};
const MOBILE = argValue('--mobile');
const EMAIL = argValue('--email') || (PROD || MOBILE ? null : 'test@example.com');
const SET = argValue('--set') || 'showcase';
/** Cap how many events of the chosen set actually get created — e.g. `--limit 1`
 * for a single test event instead of the whole set. Unset = every item. */
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : null;
/** Skip the first N items of the set — e.g. to pick item #2 instead of #1
 * when #1's name already collides with something already on the account. */
const SKIP = argValue('--skip') ? Number(argValue('--skip')) : 0;
const PLAN_ID = argValue('--plan') ? Number(argValue('--plan')) : null;
const NAME = argValue('--name');

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

/**
 * One wedding told as four events: the engagement already held, then Mehendi,
 * Nikah and Walima in the same week. `invitedOn` is when the invitations went
 * out, so response dates sit before the event.
 */
const ISMAIL = [
    {
        event: {
            name: 'Ismail & Ayesha — Engagement',
            host_one: 'Mohamed Ismail',
            host_two: 'Ayesha Siddiqa',
            tagline: 'A promise sealed with duas',
            description:
                'Alhamdulillah — with the blessings of our elders, Ismail and Ayesha were engaged '
                + 'in the presence of close family. Thank you to everyone who joined us and '
                + 'made the day so special.',
            start_date: '2026-08-16', end_date: '2026-08-16',
            start_time: '11:00', end_time: '14:00',
            venue_name: 'Taj Coromandel',
            venue_address: '37, Mahatma Gandhi Road, Nungambakkam, Chennai, Tamil Nadu 600034',
            organizer: 'The Ismail & Siddiqa Families',
            footer_note: 'Thank you for your duas',
            primary_color: '#BE185D',
        },
        splash: {
            main_title: 'ENGAGED',
            sub_title: 'Ismail & Ayesha',
            tagline: 'A promise sealed with duas',
            background_type: 'couple_photo',
            background_url: IMG.chairs,
            background_config: { fit: 'cover', overlay: 40, dark_overlay: true },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#F9A8D4', size: 60 },
            button_text: 'Enter Invitation', button_style: 'filled', button_color: '#BE185D',
        },
        guests: 16,
        invitedOn: '2026-07-25',
    },
    {
        event: {
            name: 'Ismail & Ayesha — Mehendi Night',
            host_one: 'Mohamed Ismail',
            host_two: 'Ayesha Siddiqa',
            tagline: 'Henna, music and a night to remember',
            description:
                'The celebrations begin! Join us for an evening of henna, music and laughter as we '
                + 'celebrate the Mehendi of Ismail and Ayesha with the people we love most.',
            start_date: '2026-10-23', end_date: '2026-10-23',
            start_time: '18:30', end_time: '22:30',
            venue_name: 'Sheraton Grand Chennai Resort & Spa',
            venue_address: 'East Coast Road, Mahabalipuram, Tamil Nadu 603104',
            organizer: 'The Siddiqa Family',
            footer_note: 'Dress code: shades of green and gold',
            primary_color: '#15803D',
        },
        splash: {
            main_title: 'MEHENDI NIGHT',
            sub_title: 'Celebrating Ismail & Ayesha',
            tagline: 'Henna, music and a night to remember',
            background_type: 'gradient',
            background_config: { gradient_type: 'linear', color_1: '#064E3B', color_2: '#CA8A04' },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#FFFFFF', size: 60 },
            button_text: 'Join the Celebration', button_style: 'filled', button_color: '#CA8A04',
        },
        guests: 20,
        invitedOn: '2026-09-01',
    },
    {
        event: {
            name: 'Ismail & Ayesha — Nikah Ceremony',
            host_one: 'Mohamed Ismail',
            host_two: 'Ayesha Siddiqa',
            tagline: 'Two souls, one prayer',
            description:
                'With the blessings of Allah and our families, we request the honour of your '
                + 'presence at the Nikah of Mohamed Ismail and Ayesha Siddiqa. Your duas will '
                + 'make our day complete. The ceremony will be followed by dinner.',
            start_date: '2026-10-25', end_date: '2026-10-25',
            start_time: '17:00', end_time: '21:00',
            venue_name: 'ITC Grand Chola — Grand Ballroom',
            venue_address: 'No. 63, Mount Road, Guindy, Chennai, Tamil Nadu 600032',
            organizer: 'The Ismail & Siddiqa Families',
            footer_note: 'With duas and love',
            primary_color: '#0F766E',
        },
        splash: {
            main_title: "YOU'RE INVITED",
            sub_title: 'To the Nikah of Ismail & Ayesha',
            tagline: 'Two souls, one prayer',
            background_type: 'couple_photo',
            background_url: IMG.couple,
            background_config: { fit: 'cover', overlay: 45, dark_overlay: true },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#FDE68A', size: 60 },
            button_text: 'Enter Invitation', button_style: 'filled', button_color: '#0F766E',
        },
        guests: 28,
        invitedOn: '2026-08-30',
    },
    {
        event: {
            name: 'Ismail & Ayesha — Walima Dinner',
            host_one: 'Mohamed Ismail',
            host_two: 'Ayesha Siddiqa',
            tagline: 'An evening of joy and gratitude',
            description:
                'Please join us for the Walima of Ismail and Ayesha — an evening of good food, '
                + 'family and gratitude as we begin our new life together.',
            start_date: '2026-10-27', end_date: '2026-10-27',
            start_time: '19:30', end_time: '23:00',
            venue_name: 'Hyatt Regency Chennai',
            venue_address: '365, Anna Salai, Teynampet, Chennai, Tamil Nadu 600018',
            organizer: 'The Ismail Family',
            footer_note: 'Dinner will be served',
            primary_color: '#B45309',
        },
        splash: {
            main_title: 'WALIMA',
            sub_title: 'Ismail & Ayesha',
            tagline: 'An evening of joy and gratitude',
            background_type: 'image',
            background_url: IMG.banquet,
            background_config: { overlay: 40 },
            loader_enabled: true,
            loader_config: { style: 'ring', color: '#FBBF24', size: 55 },
            button_text: 'View Invitation', button_style: 'outline', button_color: '#FBBF24',
        },
        guests: 32,
        invitedOn: '2026-08-30',
    },
];

/**
 * One wedding as three events that are PAST, LIVE and UPCOMING *whenever the
 * seeder runs* — the set to reach for when the thing being tested is the
 * status split itself (the app's Home tiles, the card's button label, the
 * portal's tabs).
 *
 * ── WHY THE DATES ARE RELATIVE ──────────────────────────────────────────────
 * Every other set hardcodes ISO dates, which is fine for a one-off demo and
 * useless for a status test: the set goes stale the moment the calendar passes
 * it, and "upcoming" quietly becomes "past" without anybody noticing. These are
 * computed from today at run time, so the three buckets are always filled.
 *
 * `status` stays `upcoming` on all three, as it does everywhere — past and live
 * are DERIVED from the dates by `deriveStatus()` and never stored (see the
 * Event model). Setting it here would not make an event past; the dates do.
 *
 * ── EACH EVENT HAS ITS OWN GUEST LIST ───────────────────────────────────────
 * Different guest counts and a different name offset per event, so no guest row
 * is shared between them — which is the point when testing that a participant
 * signing in sees ONLY the event they were invited to.
 *
 * ── COVER IMAGES ────────────────────────────────────────────────────────────
 * `cover` is a SOURCE url. It is downloaded and pushed through the very same
 * `mediaService.upload(..., { folder: 'event-covers' })` call the real
 * `POST /client/events/cover-image` endpoint makes, so the stored URL is
 * whatever this environment's media driver produces — a CloudFront/S3 link on
 * production, a local `/uploads/...` path against a machine whose media
 * settings are blank. Nothing here hardcodes a bucket URL.
 */
const dayOffset = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
};

const QA = [
    {
        event: {
            name: 'Adnan & Hafsa — Nikah',
            host_one: 'Adnan Shareef',
            host_two: 'Hafsa Begum',
            tagline: 'Alhamdulillah, we are married',
            description:
                'Alhamdulillah — the Nikah of Adnan and Hafsa was solemnised in the presence of '
                + 'our families and closest friends. Thank you to everyone who joined us and kept '
                + 'us in their duas.',
            start_date: dayOffset(-21), end_date: dayOffset(-21),
            start_time: '17:00', end_time: '21:00',
            venue_name: 'Taj Coromandel',
            venue_address: '37, Mahatma Gandhi Road, Nungambakkam, Chennai, Tamil Nadu 600034',
            organizer: 'The Shareef & Begum Families',
            footer_note: 'Thank you for your duas',
            primary_color: '#BE185D',
        },
        splash: {
            main_title: 'NIKAH',
            sub_title: 'Adnan & Hafsa',
            tagline: 'Alhamdulillah, we are married',
            background_type: 'couple_photo',
            background_url: IMG.couple,
            background_config: { fit: 'cover', overlay: 45, dark_overlay: true },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#F9A8D4', size: 60 },
            button_text: 'Enter Invitation', button_style: 'filled', button_color: '#BE185D',
        },
        cover: IMG.couple,
        guests: 14,
        invitedOn: dayOffset(-45),
    },
    {
        event: {
            // start yesterday, end tomorrow — `deriveStatus` reads this as live
            // for the whole of today, whatever hour the seeder runs at.
            name: 'Rizwan & Aleena — Walima Reception',
            host_one: 'Rizwan Ahmed',
            host_two: 'Aleena Fathima',
            tagline: 'An evening of joy and gratitude',
            description:
                'The celebrations are under way! Join us for the Walima of Rizwan and Aleena — '
                + 'an evening of good food, family and gratitude as we begin our new life together.',
            start_date: dayOffset(-1), end_date: dayOffset(1),
            start_time: '19:00', end_time: '23:00',
            venue_name: 'ITC Grand Chola',
            venue_address: 'No. 63, Mount Road, Guindy, Chennai, Tamil Nadu 600032',
            organizer: 'The Ahmed Family',
            footer_note: 'Dinner will be served',
            primary_color: '#B45309',
        },
        splash: {
            main_title: 'WALIMA',
            sub_title: 'Rizwan & Aleena',
            tagline: 'An evening of joy and gratitude',
            background_type: 'image',
            background_url: IMG.banquet,
            background_config: { overlay: 40 },
            loader_enabled: true,
            loader_config: { style: 'ring', color: '#FBBF24', size: 55 },
            button_text: 'View Invitation', button_style: 'outline', button_color: '#FBBF24',
        },
        cover: IMG.banquet,
        guests: 18,
        invitedOn: dayOffset(-30),
    },
    {
        event: {
            name: 'Suhail & Marium — Mehendi Night',
            host_one: 'Suhail Akhtar',
            host_two: 'Marium Zehra',
            tagline: 'Henna, music and a night to remember',
            description:
                'The celebrations begin! Join us for an evening of henna, music and laughter as we '
                + 'celebrate the Mehendi of Suhail and Marium with the people we love most.',
            start_date: dayOffset(35), end_date: dayOffset(35),
            start_time: '18:30', end_time: '22:30',
            venue_name: 'The Leela Palace',
            venue_address: 'Adyar Seaface, MRC Nagar, Chennai, Tamil Nadu 600028',
            organizer: 'The Akhtar Family',
            footer_note: 'Dress code: shades of green and gold',
            primary_color: '#15803D',
        },
        splash: {
            main_title: 'MEHENDI NIGHT',
            sub_title: 'Suhail & Marium',
            tagline: 'Henna, music and a night to remember',
            background_type: 'gradient',
            background_config: { gradient_type: 'linear', color_1: '#064E3B', color_2: '#CA8A04' },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#FFFFFF', size: 60 },
            button_text: 'Join the Celebration', button_style: 'filled', button_color: '#CA8A04',
        },
        cover: IMG.chairs,
        guests: 11,
        invitedOn: dayOffset(-7),
    },
];

/**
 * One upcoming wedding per production client (§527). Run once per account,
 * picking its own item:
 *   --set clients --email jamaludheen779@gmail.com --skip 0 --limit 1
 *   --set clients --email ismail@eventinvit.in     --skip 1 --limit 1
 *   --set clients --email arsath@eventinvit.in     --skip 2 --limit 1
 *   --set clients --email najeeb@eventinvit.in     --skip 3 --limit 1
 */
const CLIENTS = [
    {
        event: {
            name: 'Jamal & Ayesha — Nikah Ceremony',
            host_one: 'Jamal Mohideen',
            host_two: 'Ayesha Siddiqa',
            tagline: 'Two hearts, one duaa',
            description:
                'With the blessings of Allah and our families, we invite you to the Nikah of '
                + 'Jamal and Ayesha. Your presence and duas will make our day complete.',
            start_date: dayOffset(21), end_date: dayOffset(21),
            start_time: '11:00', end_time: '14:00',
            venue_name: 'Wallajah Big Mosque Hall',
            venue_address: 'Triplicane High Road, Triplicane, Chennai, Tamil Nadu 600005',
            organizer: 'The Mohideen Family',
            footer_note: 'Lunch will be served after the Nikah',
            primary_color: '#0F766E',
        },
        splash: {
            main_title: 'NIKAH',
            sub_title: 'Jamal & Ayesha',
            tagline: 'Two hearts, one duaa',
            background_type: 'couple_photo',
            background_url: IMG.couple,
            background_config: { fit: 'cover', overlay: 45, dark_overlay: true },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#5EEAD4', size: 60 },
            button_text: 'Enter Invitation', button_style: 'filled', button_color: '#0F766E',
        },
        cover: IMG.couple,
        guests: 12,
        invitedOn: dayOffset(-5),
    },
    {
        event: {
            name: 'Ismail & Sameera — Wedding Reception',
            host_one: 'Ismail Basha',
            host_two: 'Sameera Banu',
            tagline: 'Join us for an evening of celebration',
            description:
                'We are delighted to invite you to the wedding reception of Ismail and Sameera. '
                + 'Come share an evening of good food, family and joy with us.',
            start_date: dayOffset(40), end_date: dayOffset(40),
            start_time: '19:00', end_time: '22:30',
            venue_name: 'Hotel Savera',
            venue_address: '146, Dr. Radhakrishnan Salai, Mylapore, Chennai, Tamil Nadu 600004',
            organizer: 'The Basha Family',
            footer_note: 'Dinner from 8:00 PM',
            primary_color: '#9D174D',
        },
        splash: {
            main_title: 'RECEPTION',
            sub_title: 'Ismail & Sameera',
            tagline: 'Join us for an evening of celebration',
            background_type: 'image',
            background_url: IMG.banquet,
            background_config: { overlay: 40 },
            loader_enabled: true,
            loader_config: { style: 'ring', color: '#F9A8D4', size: 55 },
            button_text: 'View Invitation', button_style: 'outline', button_color: '#F9A8D4',
        },
        cover: IMG.banquet,
        guests: 15,
        invitedOn: dayOffset(-3),
    },
    {
        event: {
            name: 'Arsath & Nilofer — Nikah',
            host_one: 'Arsath Ali',
            host_two: 'Nilofer Nisha',
            tagline: 'And We created you in pairs',
            description:
                'By the grace of Allah, the Nikah of Arsath and Nilofer will be held in Vellore. '
                + 'We would be honoured to have you with us and to receive your duas.',
            start_date: dayOffset(14), end_date: dayOffset(14),
            start_time: '10:30', end_time: '13:30',
            venue_name: 'Hotel Darling Residency',
            venue_address: '11/8, Officers Line, Vellore, Tamil Nadu 632001',
            organizer: 'The Ali Family',
            footer_note: 'Walima lunch to follow',
            primary_color: '#1D4ED8',
        },
        splash: {
            main_title: 'NIKAH',
            sub_title: 'Arsath & Nilofer',
            tagline: 'And We created you in pairs',
            background_type: 'gradient',
            background_config: { gradient_type: 'linear', color_1: '#1E3A8A', color_2: '#0EA5E9' },
            loader_enabled: true,
            loader_config: { style: 'dots', color: '#FFFFFF', size: 60 },
            button_text: 'Open Invitation', button_style: 'filled', button_color: '#0EA5E9',
        },
        cover: IMG.chairs,
        guests: 16,
        invitedOn: dayOffset(-10),
    },
    {
        event: {
            name: 'Najeeb & Rukhsana — Walima',
            host_one: 'Najeeb Rahman',
            host_two: 'Rukhsana Parveen',
            tagline: 'A feast of gratitude',
            description:
                'Alhamdulillah! Please join us for the Walima of Najeeb and Rukhsana — a dinner '
                + 'to thank our families and friends as we begin our new life together.',
            start_date: dayOffset(55), end_date: dayOffset(55),
            start_time: '19:30', end_time: '23:00',
            venue_name: 'ITC Grand Chola',
            venue_address: 'No. 63, Mount Road, Guindy, Chennai, Tamil Nadu 600032',
            organizer: 'The Rahman Family',
            footer_note: 'Dress code: festive traditional',
            primary_color: '#B45309',
        },
        splash: {
            main_title: 'WALIMA',
            sub_title: 'Najeeb & Rukhsana',
            tagline: 'A feast of gratitude',
            background_type: 'couple_photo',
            background_url: IMG.rings,
            background_config: { fit: 'cover', overlay: 40, dark_overlay: true },
            loader_enabled: true,
            loader_config: { style: 'ring', color: '#FBBF24', size: 55 },
            button_text: 'Enter Invitation', button_style: 'filled', button_color: '#B45309',
        },
        cover: IMG.rings,
        guests: 20,
        invitedOn: dayOffset(-2),
    },
];

const SETS = {
    showcase: { items: SHOWCASE, responses: false, splashExisting: true },
    ismail: { items: ISMAIL, responses: true, splashExisting: false },
    qa: { items: QA, responses: true, splashExisting: false },
    clients: { items: CLIENTS, responses: true, splashExisting: false },
};

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
    'Arif', 'Nazia', 'Zaid', 'Iqra', 'Salman', 'Rukhsar', 'Abdul', 'Shabana', 'Irfan', 'Farhana',
    'Tariq', 'Sumaiya', 'Asif', 'Nasreen', 'Khalid', 'Zainab', 'Riyaz', 'Asma', 'Sameer', 'Heena',
    'Naveed', 'Tabassum'];
const LAST = ['Shaikh', 'Qureshi', 'Ansari', 'Hussain', 'Pathan', 'Mirza', 'Syed', 'Baig', 'Basha', 'Rahman', 'Khan'];
const RELATIONS = ['Family', 'Cousin', 'Uncle', 'Aunt', 'Friend', 'Colleague', 'Neighbour', 'Family Friend'];
const CITIES = ['Chennai', 'Chennai', 'Vellore', 'Ambur', 'Bengaluru', 'Hyderabad', 'Trichy', 'Madurai'];
const WISHES = [
    'Congratulations! We will be there, InshaAllah.',
    'Mabrook to you both — cannot wait to celebrate!',
    'So happy for you. Duas always.',
    'Wouldn\'t miss it for the world!',
    'Barakallahu lakuma — see you there.',
    null,
];
const REGRETS = [
    'So sorry, travelling abroad that week. Duas for you both!',
    'Will miss it — sending all our love and duas.',
];

/* ── Helpers ─────────────────────────────────────────────────────────────── */

async function resolveClient() {
    if (MOBILE) {
        const digits = String(MOBILE).replace(/\D/g, '').slice(-10);
        const rows = await WebsiteClient.findAll({ where: { mobile: digits } });
        if (rows.length > 1) throw new Error(`${rows.length} accounts share mobile ${digits} — refusing to guess.`);
        if (!rows.length) throw new Error(`No client with mobile ${digits} on ${PROD ? 'PRODUCTION' : 'LOCAL'}.`);
        return rows[0];
    }
    if (!EMAIL) {
        throw new Error('Against production you must name the account: --email you@example.com or --mobile 9xxxxxxxxx');
    }
    const client = await WebsiteClient.findOne({ where: { email: EMAIL } });
    if (!client) throw new Error(`No client with email ${EMAIL} on ${PROD ? 'PRODUCTION' : 'LOCAL'}.`);
    return client;
}

/**
 * Download `item.cover` and store it exactly as the cover-image endpoint would.
 *
 * Deliberately the same `mediaService.upload` call as
 * `clientEvent.service.uploadCoverImage` rather than writing the source URL
 * straight onto the row: the point of a seeded cover is to prove the real
 * storage path works, and an Unsplash link on the row would prove nothing and
 * would rot the day Unsplash changes it.
 *
 * Returns null on any failure. A cover photo is decoration — losing one is not
 * a reason to abandon a seeding run that has already created the event.
 */
async function uploadCover(item, client) {
    if (!item.cover) return null;
    try {
        const response = await axios.get(item.cover, { responseType: 'arraybuffer', timeout: 20000 });
        const buffer = Buffer.from(response.data);
        const mimetype = response.headers['content-type'] || 'image/jpeg';
        const result = await mediaService.upload(
            {
                buffer,
                mimetype,
                size: buffer.length,
                originalname: `${item.event.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.jpg`,
            },
            { folder: 'event-covers' },
            client.company_id || 1,
        );
        return result?.url || null;
    } catch (e) {
        console.log(`    ! cover image skipped (${e.message})`);
        return null;
    }
}

/** One event body, scoped to what the account's plan offers. */
function eventBody(item, options, client, templateCode, coverUrl) {
    const category = options.categories[0];

    return {
        ...item.event,
        event_category_id: category.id,
        timezone: 'Asia/Kolkata',
        contact_email: client.email || null,
        contact_phone: client.mobile ? `+91 ${client.mobile}` : null,
        privacy: 'private',
        status: 'upcoming',
        menu_ids: options.menus.map((m) => m.id),
        theme_id: templateCode || null,
        cover_image: coverUrl || null,
    };
}

const addDays = (isoDate, days, hour = 10) => {
    const d = new Date(`${isoDate}T00:00:00+05:30`);
    d.setDate(d.getDate() + days);
    d.setHours(d.getHours() + hour);
    return d;
};

/**
 * The answer guest `i` gave. Upcoming events: roughly half accepted, some
 * declined or unsure, a fifth not answered yet. A past event: everyone answered.
 */
function responseFor(i, past) {
    const slot = i % 10;
    if (past) return slot < 8 ? 'yes' : 'no';
    if (slot < 5) return 'yes';
    if (slot < 6) return 'no';
    if (slot < 8) return 'maybe';
    return 'none';
}

function guestRows(event, client, item, offset, responses) {
    const past = String(item.event.end_date) < new Date().toISOString().slice(0, 10);
    return Array.from({ length: item.guests }, (_, i) => {
        const first = FIRST[(i + offset) % FIRST.length];
        const last = LAST[(i * 3 + offset) % LAST.length];
        const row = {
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
        if (!responses) return row;

        const answer = responseFor(i, past);
        const invitedAt = addDays(item.invitedOn, 0, 10 + (i % 6));
        row.whatsapp = row.mobile;
        row.city = CITIES[(i + offset) % CITIES.length];
        row.state = ['Bengaluru', 'Hyderabad'].includes(row.city) ? (row.city === 'Bengaluru' ? 'Karnataka' : 'Telangana') : 'Tamil Nadu';
        row.invite_source = ['whatsapp', 'whatsapp', 'import', 'manual'][i % 4];
        row.invited_at = invitedAt;
        row.table_number = answer === 'yes' ? String(1 + Math.floor(i / 6)) : null;
        row.rsvp_status = { yes: 'accepted', no: 'declined', maybe: 'pending', none: 'invited' }[answer];
        row.response_type = answer;
        if (answer !== 'none') row.responded_at = addDays(item.invitedOn, 1 + (i % 9), 9 + (i % 10));
        if (answer === 'yes') row.notes = WISHES[i % WISHES.length];
        if (answer === 'no') row.notes = REGRETS[i % REGRETS.length];
        return row;
    });
}

/** One delivered/sent invite per guest — history rows, nothing is dispatched. */
function inviteRows(guests, client) {
    return guests.map((g, i) => {
        const sentAt = new Date(g.invited_at);
        const delivered = i % 7 !== 3;
        return {
            event_id: g.event_id,
            participant_id: g.id,
            website_client_id: client.id,
            channel: i % 5 === 4 ? 'email' : 'whatsapp',
            kind: 'invite',
            status: delivered ? 'delivered' : 'sent',
            sent_at: sentAt,
            delivered_at: delivered ? new Date(sentAt.getTime() + 60 * 1000) : null,
            opened_at: g.response_type !== 'none' ? new Date(sentAt.getTime() + 3 * 3600 * 1000) : null,
            sender: 'client',
            sender_client_id: client.id,
        };
    });
}

async function clear(client, items) {
    const events = await Event.findAll({
        where: { website_client_id: client.id, name: { [Op.in]: items.map((s) => s.event.name) } },
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

    const messages = ids.length ? await EventMessage.destroy({ where: { event_id: { [Op.in]: ids } }, force: true }) : 0;
    const guests = ids.length ? await EventParticipant.destroy({ where: { event_id: { [Op.in]: ids } }, force: true }) : 0;
    const gone = ids.length ? await Event.destroy({ where: { id: { [Op.in]: ids } } }) : 0;
    console.log(`  removed ${gone} event(s), ${guests} guest(s), ${messages} invite record(s), ${splashes.length} splash screen(s)`);
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    try {
        const rawSet = SETS[SET];
        if (!rawSet) throw new Error(`Unknown --set ${SET}. Known: ${Object.keys(SETS).join(', ')}`);
        const sliced = rawSet.items.slice(SKIP, LIMIT ? SKIP + LIMIT : undefined);
        const set = { ...rawSet, items: sliced };

        const client = await resolveClient();
        console.log(`Account: #${client.id}  ${client.name}  <${client.email || 'no email'}>  +91 ${client.mobile || '—'}  plan=${client.subscription_plan_id ?? 'none'}`);
        console.log(`Set:     ${SET} (${set.items.length}${LIMIT ? ` of ${rawSet.items.length}` : ''} events)`);

        if (CLEAR) {
            if (PROD && !APPLY) { console.log('\n  DRY RUN — add --apply to remove.\n'); return; }
            await clear(client, set.items);
            return;
        }

        // ── The account itself: plan and display name ──────────────────────
        const accountChanges = {};
        if (PLAN_ID && Number(client.subscription_plan_id) !== PLAN_ID) {
            const plan = await SubscriptionPlan.findByPk(PLAN_ID, { attributes: ['id', 'name', 'is_active'] });
            if (!plan || !plan.is_active) throw new Error(`Plan ${PLAN_ID} does not exist or is inactive.`);
            accountChanges.subscription_plan_id = PLAN_ID;
            console.log(`${APPLY || !PROD ? 'SET' : 'WOULD SET'}  plan -> #${plan.id} ${plan.name}`);
        }
        if (NAME && client.name !== NAME) {
            accountChanges.name = NAME;
            console.log(`${APPLY || !PROD ? 'SET' : 'WOULD SET'}  name "${client.name}" -> "${NAME}"`);
        }
        if (Object.keys(accountChanges).length && (APPLY || !PROD)) {
            await client.update(accountChanges);
        }

        const already = await Event.count({
            where: { website_client_id: client.id, name: { [Op.in]: set.items.map((s) => s.event.name) } },
        });
        if (already && !process.argv.includes('--list')) {
            console.log(`  ${already} event(s) from this set already on this account — run with --clear first to reseed.\n`);
            return;
        }

        if (!APPLY && PROD && !process.argv.includes('--list')) {
            if (accountChanges.subscription_plan_id) {
                set.items.forEach((s) => console.log(
                    `  WOULD CREATE  ${s.event.name}  (${s.event.start_date}, ${s.event.venue_name}) `
                    + `+ ${s.guests} guests + ${s.splash.background_type} splash`,
                ));
                console.log('\n  (plan not assigned yet, so its scope and themes are resolved on --apply)');
                console.log('\n  DRY RUN — add --apply to write.\n');
                return;
            }
        }

        const options = await portalService.getEventOptions(client.id);
        if (!options.plan) throw new Error(options.reason || 'This account has no usable plan.');
        if (!options.categories.length) throw new Error('The plan offers no event category.');

        if (process.argv.includes('--list')) {
            console.log(`\nAll categories this plan offers: ${options.categories.map((c) => `${c.id}:${c.name}`).join(', ')}`);
            console.log(`All menus:      ${options.menus.map((m) => `${m.id}:${m.slug}`).join(', ')}`);
            return;
        }

        const templates = options.templates || [];
        console.log(`Plan:    ${options.plan.name}`);
        console.log(`Scope:   ${options.categories[0].name}`);
        console.log(`Menus:   ${options.menus.map((m) => m.slug).join(', ') || '(none)'}`);
        console.log(`Themes:  ${templates.map((t) => t.code).join(', ') || '(none — built-in fallback)'}\n`);

        const existingNoSplash = set.splashExisting ? await Event.findAll({
            where: {
                website_client_id: client.id,
                id: { [Op.notIn]: sequelize.literal('(SELECT event_id FROM splash_screens WHERE event_id IS NOT NULL AND deleted_at IS NULL)') },
            },
            attributes: ['id', 'name'],
            order: [['id', 'DESC']],
            limit: 1,
        }) : [];

        if (!APPLY && PROD) {
            set.items.forEach((s, i) => console.log(
                `  WOULD CREATE  ${s.event.name}  (${s.event.start_date}, ${s.event.venue_name}) `
                + `theme=${templates.length ? templates[(i + SKIP) % templates.length].code : '—'}  `
                + `+ ${s.guests} guests + ${s.splash.background_type} splash`,
            ));
            if (existingNoSplash[0]) console.log(`  WOULD ADD     splash to existing event #${existingNoSplash[0].id} ${existingNoSplash[0].name}`);
            console.log('\n  DRY RUN — add --apply to write.\n');
            return;
        }

        for (const [i, item] of set.items.entries()) {
            const theme = templates.length ? templates[(i + SKIP) % templates.length].code : null;
            const cover = await uploadCover(item, client);
            const event = await eventService.createEvent(client.id, eventBody(item, options, client, theme, cover));

            const guests = await EventParticipant.bulkCreate(guestRows(event, client, item, i * 7, set.responses));
            const invites = set.responses ? await EventMessage.bulkCreate(inviteRows(guests, client)) : [];

            const splash = await splashService.createSplashScreen(client.id, client.company_id, {
                ...item.splash,
                name: `${SPLASH_MARK}${item.event.name}`,
                event_id: event.id,
                show_couple_name: true,
                show_event_date: true,
                show_tagline: true,
                status: 'active',
            });
            const said = (t) => guests.filter((g) => g.response_type === t).length;
            console.log(`  + event #${event.id}  ${event.name}  ${event.derived_status}  theme=${event.theme_id || '—'}  qr=${event.qr_token ? 'yes' : 'no'}`
                + `  cover=${event.cover_image || '—'}`
                + `  guests=${guests.length}${set.responses ? ` (yes ${said('yes')}, no ${said('no')}, maybe ${said('maybe')}, pending ${said('none')})` : ''}`
                + `${set.responses ? `  invites=${invites.length}` : ''}  splash #${splash.id} (${splash.background_type})`);
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
