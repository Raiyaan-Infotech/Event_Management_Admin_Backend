/**
 * Demo data for the Splash Screens module — one saved config per background
 * type, so the list and the editor have something real to look at.
 *
 *   node src/database/seeders/splash-screens-demo.seeder.js
 *   node src/database/seeders/splash-screens-demo.seeder.js --clear
 *   node src/database/seeders/splash-screens-demo.seeder.js --email you@example.com
 *   node src/database/seeders/splash-screens-demo.seeder.js --prod --email you@example.com --apply
 *
 * ── ⚠ IT WRITES TO EXACTLY ONE ACCOUNT, NAMED BY EMAIL ──────────────────────
 * Same rule as client-messages-demo.seeder.js: production has real people's
 * accounts on it, so `--email` is REQUIRED against production, resolved
 * before anything is written, and the run prints whose account it is and
 * waits for `--apply`. Locally it defaults to the seeded test client.
 *
 * ── MARKED SO --clear IS EXACT ───────────────────────────────────────────────
 * Every row this seeder writes has its `name` prefixed `[Demo] `. `--clear`
 * removes rows matching that prefix and nothing else — never by client id,
 * which would take real rows with it.
 *
 * ── ⚠ THE IMAGE/VIDEO URLS ARE PUBLIC STOCK MEDIA, NOT UPLOADS ──────────────
 * `background_url` for the Image, Logo and Couple Photo rows points at
 * specific Unsplash CDN images (real, working URLs, individually checked —
 * downloaded and visually inspected before being picked — so "birthday" shows
 * balloons and "reception" shows a set banquet hall, not a mismatched stock
 * photo) because no file has actually been uploaded through this account.
 * They are stand-ins, not this account's own media — a screenshot will show
 * a stranger's photo, which is the honest state until someone uploads theirs.
 *
 * The Video row uses a real, playable MP4 (MDN's public cc0 sample clip) so
 * the video background type has something that actually demonstrates video
 * playback rather than a static frame — it is a generic clip, not a wedding
 * video, chosen for being a stable, always-reachable URL rather than for
 * thematic fit. Its `fallback_image_url` IS thematically chosen.
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
const { sequelize, WebsiteClient, SplashScreen, Sequelize } = db;
const { Op } = Sequelize;

const NAME_MARK = '[Demo] ';

const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};

const EMAIL = argValue('--email') || (PROD ? null : 'test@example.com');

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

/* ── The six rows ────────────────────────────────────────────────────────── */

const ROWS = (clientId, companyId) => [
    {
        website_client_id: clientId,
        company_id: companyId,
        name: `${NAME_MARK}Priya & Arjun — Wedding`,
        main_title: "YOU'RE INVITED",
        sub_title: 'To',
        event_name: 'Priya & Arjun Wedding',
        tagline: 'Together with their families',
        background_type: 'gradient',
        background_config: { gradient_type: 'linear', direction: 'diagonal', color_1: '#6A11CB', color_2: '#FF2575' },
        sound_enabled: false,
        loader_enabled: true,
        loader_config: { style: 'dots', color: '#FFFFFF', size: 60, background_color: '#6A11CB' },
        animation_enabled: false,
        button_text: 'Enter Invitation',
        button_style: 'filled',
        button_color: '#FFFFFF',
        show_couple_name: true,
        show_event_date: true,
        show_tagline: true,
        status: 'active',
    },
    {
        website_client_id: clientId,
        company_id: companyId,
        name: `${NAME_MARK}Rohan & Sneha — Reception`,
        main_title: "YOU'RE INVITED",
        sub_title: 'To',
        event_name: 'Rohan & Sneha Reception',
        tagline: 'An evening of celebration',
        background_type: 'image',
        // A set banquet hall — verified by downloading and viewing it before
        // picking it, not guessed from the URL. See file header.
        background_url: 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1080&q=70',
        background_config: { overlay: 35 },
        sound_enabled: true,
        sound_config: { auto_play: true, loop: true, volume: 60 },
        loader_enabled: true,
        loader_config: { style: 'ring', color: '#FBBF24', size: 55, background_color: '#0F766E' },
        animation_enabled: false,
        button_text: 'Enter Invitation',
        button_style: 'outline',
        button_color: '#FBBF24',
        show_couple_name: true,
        show_event_date: true,
        show_tagline: true,
        status: 'active',
    },
    {
        website_client_id: clientId,
        company_id: companyId,
        name: `${NAME_MARK}Karan's Birthday Bash`,
        main_title: "YOU'RE INVITED",
        sub_title: 'To',
        event_name: "Karan's 30th Birthday Bash",
        tagline: 'Come dance the night away',
        background_type: 'image',
        // Colourful balloons — verified by downloading and viewing it before
        // picking it, not guessed from the URL. See file header.
        background_url: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=1080&q=70',
        background_config: { overlay: 45 },
        sound_enabled: true,
        sound_config: { auto_play: false, loop: true, volume: 80 },
        loader_enabled: true,
        loader_config: { style: 'pulse', color: '#F97316', size: 60, background_color: '#111827' },
        animation_enabled: true,
        animation_config: {
            style: 'lights_sparkles', speed: 'fast', density: 70,
            overlay_color: '#000000', overlay_opacity: 20, loop: true,
        },
        button_text: "Let's Party",
        button_style: 'filled',
        button_color: '#F97316',
        show_couple_name: false,
        show_event_date: true,
        show_tagline: true,
        status: 'draft',
    },
    {
        website_client_id: clientId,
        company_id: companyId,
        name: `${NAME_MARK}Meera & Dev — Wedding`,
        main_title: "YOU'RE INVITED",
        sub_title: 'To',
        event_name: 'Meera & Dev Wedding',
        tagline: 'Two hearts, one journey',
        background_type: 'video',
        // A real, playable clip — generic, not wedding footage, chosen for
        // being a stable always-reachable URL. See file header.
        background_url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        // The fallback IS thematically chosen: bride and groom with a
        // bouquet, verified by downloading and viewing it first.
        fallback_image_url: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1080&q=70',
        background_config: { video_start: 'from_beginning', volume: 80, overlay: 40 },
        sound_enabled: false,
        loader_enabled: true,
        loader_config: { style: 'spinner', color: '#E91E63', size: 60, background_color: '#000000' },
        animation_enabled: false,
        button_text: 'Enter Invitation',
        button_style: 'filled',
        button_color: '#E91E63',
        show_couple_name: true,
        show_event_date: true,
        show_tagline: true,
        status: 'draft',
    },
    {
        website_client_id: clientId,
        company_id: companyId,
        name: `${NAME_MARK}Aisha's Engagement`,
        main_title: "YOU'RE INVITED",
        sub_title: 'To',
        event_name: "Aisha & Farhan's Engagement",
        tagline: null,
        background_type: 'logo',
        // A close-up of joined hands wearing wedding rings, square-cropped —
        // a stand-in for an uploaded monogram/logo, verified before picking.
        background_url: 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=600&h=600&fit=crop&q=70',
        background_config: { size: 55, position: 'top-center' },
        sound_enabled: false,
        loader_enabled: false,
        animation_enabled: false,
        button_text: 'Enter Invitation',
        button_style: 'text',
        button_color: '#111827',
        show_couple_name: true,
        show_event_date: false,
        show_tagline: false,
        status: 'active',
    },
    {
        website_client_id: clientId,
        company_id: companyId,
        name: `${NAME_MARK}Ananya & Vikram — Save the Date`,
        main_title: "YOU'RE INVITED",
        sub_title: 'To',
        event_name: 'Ananya & Vikram Wedding',
        tagline: 'Save the date',
        background_type: 'couple_photo',
        // Two chairs at a ceremony reading "Forever" / "Always" — verified
        // by downloading and viewing it before picking it. See file header.
        background_url: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=1080&q=70',
        background_config: { fit: 'cover', overlay: 40, dark_overlay: true },
        sound_enabled: false,
        loader_enabled: true,
        loader_config: { style: 'bars', color: '#E91E63', size: 60, background_color: '#1F2937' },
        animation_enabled: false,
        button_text: 'Enter Invitation',
        button_style: 'filled',
        button_color: '#E91E63',
        show_couple_name: true,
        show_event_date: true,
        show_tagline: true,
        status: 'draft',
    },
];

/* ── Run ─────────────────────────────────────────────────────────────────── */

async function clear(client) {
    const count = await SplashScreen.destroy({
        where: { website_client_id: client.id, name: { [Op.like]: `${NAME_MARK}%` } },
    });
    console.log(`  removed ${count} demo splash screen(s)`);
}

async function seedFor(client) {
    const rows = await SplashScreen.bulkCreate(ROWS(client.id, client.company_id));
    console.log(`  + ${rows.length} splash screens:`);
    rows.forEach((r) => console.log(`      #${r.id}  ${r.name}  (${r.background_type}, ${r.status})`));
}

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
        const existing = await SplashScreen.count({
            where: { website_client_id: client.id, name: { [Op.like]: `${NAME_MARK}%` } },
        });
        if (existing > 0) {
            console.log(`  ${existing} demo splash screens already present — run with --clear first to reseed.\n`);
            return;
        }

        if (PROD && !APPLY) {
            console.log(`  DRY RUN — this would seed ${ROWS(0, null).length} splash screens`);
            console.log('  onto the account above. Add --apply to write.\n');
            return;
        }

        await seedFor(client);
        console.log('\n  seeded\n');
    } finally {
        await sequelize.close();
    }
})().catch((e) => { console.error('\nFAILED:', e.message, '\n'); process.exit(1); });
