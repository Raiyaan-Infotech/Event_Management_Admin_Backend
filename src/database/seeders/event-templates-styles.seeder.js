#!/usr/bin/env node
/**
 * Sixteen finished templates: Royal, Elegant, Minimal and Traditional, one per
 * template type (Color, Image, Gradient, Custom) — the same set
 * `event-templates-classic.seeder.js` makes for Classic.
 *
 *   node src/database/seeders/event-templates-styles.seeder.js                  (dry run, local)
 *   node src/database/seeders/event-templates-styles.seeder.js --apply
 *   node src/database/seeders/event-templates-styles.seeder.js --prod           (dry run, production)
 *   node src/database/seeders/event-templates-styles.seeder.js --prod --apply
 *   ... --apply --refresh    also rewrites these templates (and only these)
 *   ... --only=<code>        one template
 *
 * ── WHAT EACH IS BUILT FROM ────────────────────────────────────────────────
 *   - A FRAME from Templates → Frame Styles, looked up by name. They are the
 *     public-domain vintage borders `frame-styles-vintage.seeder.js` adds (and
 *     Heritage Scroll Gold, which the Classic seeder adds) — run those first
 *     on a database that does not have them. A missing frame stops the run
 *     and names it; nothing is written until every frame is found.
 *   - FONTS from Templates → Fonts (`template-fonts.seeder.js`).
 *   - For an Image template, a public-domain PICTURE in `assets/` — a damask,
 *     two William Morris wallpapers and an Indian chintz, from Wikimedia
 *     Commons (`assets/pictures.json` lists each source and licence).
 *   - For a Custom template, the couple photograph the Classic seeder uses.
 *     A Custom template is where the host's own photograph goes, so its
 *     sample has to show one. It is a free Unsplash picture (ARTO SURAJ) of
 *     identifiable people with no model release — a SAMPLE: replace it with a
 *     picture the business owns before selling the templates.
 *   - Five rows on every card (title & names, date, venue, QR). The host can
 *     switch the rest on.
 *
 * Light pictures (Willow, Chintz) sit under a pale WASH (`overlay_color`) so
 * the words can be dark; dark ones under a black shade with pale words. A
 * `frame_color` draws a bronze border in the same colour as the words.
 *
 * ── IT ONLY ADDS ───────────────────────────────────────────────────────────
 * A template is matched by its `code`; one that exists — live or deleted — is
 * skipped, never updated, unless `--refresh` (live rows only; it discards
 * edits made to those templates in the admin).
 */
require('dotenv').config({
    path: process.argv.includes('--prod') ? '.env.production' : '.env',
});

const fs = require('fs');
const path = require('path');
const db = require('../../models');
const mediaService = require('../../services/media.service');

const { EventTemplate, EventCategory, TemplateCategory, FrameStyle } = db;

const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const REFRESH = process.argv.includes('--refresh');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const COMPANY_ID = 1;

/** MUST match COMPONENT_KEYS in eventTemplate.service.js. */
const COMPONENT_KEYS = [
    'event_title', 'host_names', 'date_time', 'venue', 'event_qr_code', 'organizer',
    'event_photos', 'contact_details', 'invitation_message',
    'footer_note', 'decoration_elements',
];
const PERMISSION_KEYS = ['background', 'colors', 'fonts', ...COMPONENT_KEYS];
const allOn = (keys) => Object.fromEntries(keys.map((k) => [k, 1]));

/** The styles the wizard has its own Step 2 arrangement for; any other uses Classic's. */
const LAYOUT_STYLES = ['classic', 'modern', 'elegant', 'minimal', 'traditional'];

const ROWS = ['event_title', 'host_names', 'date_time', 'venue', 'event_qr_code'];
const sections = (shown) => ({
    components: Object.fromEntries(COMPONENT_KEYS.map((k) => [k, shown.includes(k) ? 1 : 0])),
    component_order: [...shown, ...COMPONENT_KEYS.filter((k) => !shown.includes(k))],
});

const COUPLE = 'assets/classic-couple-portrait.jpg';

/* The four shapes a template takes. `c` = the columns that differ. */
const color = (bg, words, c = {}) => ({
    background_type: 'color',
    columns: { background_color: bg, secondary_color: words, overlay_opacity: 0, ...c },
});
const gradient = (from, via, to, mid, words, c = {}) => ({
    background_type: 'gradient',
    columns: {
        gradient_type: 'linear', gradient_direction: 'bottom',
        gradient_from: from, gradient_via: via, gradient_to: to,
        // `background_color` is the tone the text colour is worked out against.
        background_color: mid, secondary_color: words, overlay_opacity: 0, ...c,
    },
});
const image = (file, tone, words, shade, c = {}) => ({
    background_type: 'image',
    photo: { file, path: `assets/${file}.jpg` },
    columns: {
        background_color: tone, secondary_color: words,
        image_position: 'center', image_scale: 'cover', overlay_opacity: shade, ...c,
    },
});
/** Event Photos stays ON — on a custom template it is what shows the host's picture. */
const custom = (tone, words, shade, c = {}) => ({
    background_type: 'custom',
    photo: { file: 'classic-couple-portrait', path: COUPLE },
    custom: true,
    columns: {
        background_color: tone, secondary_color: words,
        image_shape: 'rectangle', corner_radius: 0, background_position: 'center',
        overlay_opacity: shade, ...c,
    },
});

const T = (category, code, name, description, frame, fonts, design) => ({
    category, code, name, description, frame,
    primary_font: fonts[0], secondary_font: fonts[1],
    ...design,
    columns: { primary_font_size: fonts[2] ?? 100, secondary_font_size: fonts[3] ?? 100, ...design.columns },
    ...sections(design.custom ? [...ROWS, 'event_photos'] : ROWS),
});

const ALL_TEMPLATES = [
    /* ── Royal: navy, crimson and gold ── */
    T('royal', 'royal-navy-crown', 'Royal Navy', 'Navy with gold lettering inside a gold Art Deco border.',
        'Deco Lace Gold', ['Imperial Script', 'Cinzel', 115],
        color('#14213D', '#E3C376')),
    T('royal', 'royal-crimson-damask', 'Crimson Damask', 'A crimson and gold damask under a shade, with gold lettering between engraved columns.',
        'Column Arch Gold', ['Imperial Script', 'Cinzel', 110],
        image('royal-crimson-damask', '#4A0C18', '#F6E2A8', 50)),
    T('royal', 'royal-midnight-wine', 'Midnight Wine', 'Midnight blue deepening to wine, with gold lettering in an engraved gold frame.',
        'Heritage Scroll Gold', ['Pinyon Script', 'Cormorant Garamond', 115, 105],
        gradient('#0B1736', '#2B2156', '#5A1637', '#2B2156', '#E8D08F')),
    T('royal', 'royal-portrait', 'Royal Portrait', 'Your own photograph in a gold vine border, with gold lettering.',
        'Vine Lace Gold', ['Imperial Script', 'Cinzel', 110],
        custom('#2A1A14', '#F6E2A8', 55)),

    /* ── Elegant: aubergine, blush and champagne, Art Nouveau borders ── */
    T('elegant', 'elegant-aubergine', 'Aubergine', 'Deep aubergine with champagne lettering in a gold Art Nouveau border.',
        'Nouveau Berry Gold', ['Corinthia', 'Cormorant Garamond', 120, 105],
        color('#2B1B3D', '#F1DDB0')),
    T('elegant', 'elegant-night-garden', 'Night Garden', 'A dark William Morris floral under a shade, with cream lettering and a fine gold line.',
        'Leaf Corner Line Gold', ['Corinthia', 'Cormorant Garamond', 120, 105],
        image('elegant-night-garden', '#17241F', '#F4E6C8', 60)),
    T('elegant', 'elegant-blush-veil', 'Blush Veil', 'Blush fading to mauve with plum lettering and an acanthus border in the same plum.',
        'Nouveau Acanthus Bronze', ['Petit Formal Script', 'EB Garamond'],
        gradient('#FBF1EE', null, '#EBD9E4', '#F3E5E9', '#5A1F3D', { frame_color: '#5A1F3D' })),
    T('elegant', 'elegant-portrait', 'Elegant Portrait', 'Your own photograph in a gold poppy border, with cream lettering.',
        'Nouveau Poppy Gold', ['Corinthia', 'Cormorant Garamond', 120, 105],
        custom('#241C22', '#F4E6C8', 55)),

    /* ── Minimal: paper, mist and a single ink ── */
    T('minimal', 'minimal-paper-white', 'Paper White', 'Warm white with slate lettering and a fine slate line with leaf corners.',
        'Leaf Corner Line Bronze', ['Cormorant', 'Jost'],
        color('#FAFAF7', '#2F3A4A', { frame_color: '#2F3A4A' })),
    T('minimal', 'minimal-willow', 'Willow', 'A William Morris willow pattern under a white wash, with deep green lettering.',
        'Scalloped Line Bronze', ['Cormorant', 'Jost'],
        image('minimal-willow', '#FFFFFF', '#2F4A3A', 62, { overlay_color: '#FFFFFF', frame_color: '#2F4A3A' })),
    T('minimal', 'minimal-morning-mist', 'Morning Mist', 'Warm grey fading to pale blue with slate lettering and a scalloped slate line.',
        'Scalloped Line Bronze', ['Playfair Display', 'Jost'],
        gradient('#F4F1EA', null, '#E3ECF2', '#ECEEED', '#2F3A4A', { frame_color: '#2F3A4A' })),
    T('minimal', 'minimal-portrait', 'Minimal Portrait', 'Your own photograph with white lettering and a fine white line.',
        'Leaf Corner Line Gold', ['Cormorant', 'Jost'],
        custom('#2A2A2A', '#FFFFFF', 50, { frame_color: '#FFFFFF' })),

    /* ── Traditional: maroon and gold ── */
    T('traditional', 'traditional-maroon-gold', 'Maroon & Gold', 'Maroon with gold lettering inside a gold lace border.',
        'Heart Lace Gold', ['Rouge Script', 'Marcellus', 115],
        color('#7A1220', '#EBC76A')),
    T('traditional', 'traditional-chintz-garden', 'Chintz Garden', 'An eighteenth-century Indian chintz under an ivory wash, with maroon lettering and a maroon vine border.',
        'Vine Lace Bronze', ['Rouge Script', 'Marcellus', 110],
        image('traditional-chintz', '#FFF8EC', '#7A1220', 58, { overlay_color: '#FFF8EC', frame_color: '#7A1220' })),
    T('traditional', 'traditional-sindoor', 'Sindoor', 'Deep red rising to vermilion with gold lettering in a gold palmette frame.',
        'Palmette Frame Gold', ['Great Vibes', 'Marcellus', 115],
        gradient('#5A0B16', null, '#8E1B2A', '#74131F', '#EBC76A')),
    T('traditional', 'traditional-portrait', 'Traditional Portrait', 'Your own photograph in an engraved gold lily border, with gold lettering.',
        'Engraved Lily Gold', ['Rouge Script', 'Marcellus', 110],
        custom('#2E1612', '#F6E2A8', 55)),
];

const TEMPLATES = ONLY ? ALL_TEMPLATES.filter((t) => t.code === ONLY) : ALL_TEMPLATES;
if (ONLY && TEMPLATES.length === 0) {
    console.error(`No template with the code "${ONLY}" in this seeder.`);
    process.exit(1);
}

const upload = async (name, buffer) => {
    const stored = await mediaService.upload(
        { buffer, mimetype: 'image/jpeg', size: buffer.length, originalname: `${name}.jpg` },
        { folder: 'templates' },
        COMPANY_ID
    );
    return stored.url;
};

(async () => {
    console.log(`\n  event-templates-styles — ${PROD ? 'PRODUCTION' : 'LOCAL'}${APPLY ? '' : '  (DRY RUN)'}\n`);

    const frameNames = [...new Set(TEMPLATES.map((t) => t.frame))];
    const slugs = [...new Set(TEMPLATES.map((t) => t.category))];

    const [eventCategories, categories, frames, existing, maxSort] = await Promise.all([
        EventCategory.findAll({ where: { company_id: COMPANY_ID }, attributes: ['id', 'name'] }),
        TemplateCategory.findAll({ where: { company_id: COMPANY_ID, slug: slugs } }),
        FrameStyle.findAll({ where: { company_id: COMPANY_ID, name: frameNames } }),
        // paranoid: false — a soft-deleted row still holds its `code`.
        EventTemplate.findAll({
            where: { company_id: COMPANY_ID, code: TEMPLATES.map((t) => t.code) },
            attributes: ['id', 'code', 'deleted_at'],
            paranoid: false,
        }),
        EventTemplate.max('sort_order', { where: { company_id: COMPANY_ID } }),
    ]);

    const eventCategory =
        eventCategories.find((c) => String(c.name).trim().toLowerCase() === 'wedding') || eventCategories[0];
    const category = new Map(categories.map((c) => [c.slug, c]));
    const haveFrame = new Map(frames.map((f) => [f.name, f]));

    // Nothing is written until every piece is accounted for.
    const missing = [
        ...(eventCategory ? [] : ['an event category']),
        ...slugs.filter((s) => !category.has(s)).map((s) => `template category "${s}"`),
        ...frameNames.filter((n) => !haveFrame.has(n)).map((n) => `frame style "${n}"`),
        ...[...new Set(TEMPLATES.filter((t) => t.photo).map((t) => t.photo.path))]
            .filter((p) => !fs.existsSync(path.join(__dirname, p)))
            .map((p) => `file ${p}`),
    ];
    if (missing.length) {
        console.log(`  FAIL  missing: ${missing.join(', ')}.\n`);
        process.exit(1);
    }

    const taken = new Set(existing.map((r) => r.code));
    const live = new Map(existing.filter((r) => !r.deleted_at).map((r) => [r.code, r]));
    const action = (t) => (!taken.has(t.code) ? 'create' : REFRESH && live.has(t.code) ? 'update' : 'skip  ');
    const todo = TEMPLATES.filter((t) => action(t) !== 'skip  ');

    for (const t of TEMPLATES) {
        console.log(`  ${action(t)}  ${t.code.padEnd(28)} ${t.name.padEnd(22)} ${t.background_type.padEnd(9)} ${t.frame}`);
    }
    console.log(`\n  ${todo.length} to write · ${TEMPLATES.length - todo.length} skipped`);

    if (!APPLY) {
        console.log('  Dry run — nothing changed. Re-run with --apply.\n');
        process.exit(0);
    }
    console.log('');

    // One upload per picture, however many templates use it.
    const uploaded = new Map();
    const pictureUrl = async (photo) => {
        if (!uploaded.has(photo.path)) {
            uploaded.set(photo.path, await upload(photo.file, fs.readFileSync(path.join(__dirname, photo.path))));
        }
        return uploaded.get(photo.path);
    };

    let sort = Number(maxSort) || 0;
    for (const t of todo) {
        const current = live.get(t.code) || null;
        // A refreshed row keeps the picture it already has.
        const imageUrl = t.photo && !current ? await pictureUrl(t.photo) : null;

        const design = {
            name: t.name,
            event_category_id: eventCategory.id,
            template_category_id: category.get(t.category).id,
            style: t.category,
            tags: [t.category, t.background_type],
            description: t.description,

            layout_style: LAYOUT_STYLES.includes(t.category) ? t.category : 'classic',
            background_type: t.background_type,
            ...t.columns,
            ...(imageUrl ? { background_image: imageUrl } : {}),

            orientation: 'portrait',
            dimension: '1080x1920',
            primary_font: t.primary_font,
            secondary_font: t.secondary_font,
            frame_style_id: haveFrame.get(t.frame).id,
            decoration_ids: [],

            components: t.components,
            component_order: t.component_order,
            permissions: allOn(PERMISSION_KEYS),
        };

        if (current) {
            await EventTemplate.update(design, { where: { id: current.id } });
            console.log(`  update  ${t.code.padEnd(28)} #${current.id}`);
            continue;
        }

        sort += 1;
        const row = await EventTemplate.create({
            company_id: COMPANY_ID,
            code: t.code,
            ...design,

            status: 'published',
            is_active: 1,
            is_featured: 0,
            available_for: ['individual', 'company'],
            plan_availability: 'all',
            plan_ids: [],
            sort_order: sort,
            show_on_homepage: 0,
            // No thumbnail: one REPLACES the drawn invitation on every tile.
            thumbnail: null,
        });
        console.log(`  create  ${t.code.padEnd(28)} #${row.id}  ${row.name}`);
    }

    const total = await EventTemplate.count({ where: { company_id: COMPANY_ID } });
    console.log(`\n  ${todo.length} written · live templates now: ${total}\n`);
    process.exit(0);
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
