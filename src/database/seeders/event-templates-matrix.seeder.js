/**
 * One sample template per (layout style x background type) — 5 x 4 = 20 rows.
 *
 * ── WHY A SECOND TEMPLATE SEEDER ─────────────────────────────────────────────
 * `event-templates.seeder.js` produces a realistic CATALOGUE: nine templates a
 * client would plausibly browse, every one of them `background_type: 'image'`.
 * That is the right shape for a demo, and the wrong shape for proving the step 2
 * form works, because it exercises exactly one of the four background types and
 * one field set out of twenty.
 *
 * This seeder is the other half: every cell of the matrix, each row carrying the
 * fields THAT cell's form actually offers and nothing else. It is what you point
 * at when the question is "does Elegant/Gradient save its third colour" rather
 * than "what does the gallery look like".
 *
 * ── THE FIELD SETS MIRROR STEP2_FIELDS ───────────────────────────────────────
 * `CELLS` below is the backend's copy of the frontend's `STEP2_FIELDS`
 * (src/hooks/use-event-templates.ts). They MUST agree — a template seeded with
 * a value its form never shows is a row nobody can edit.
 *
 * `tests/template-matrix.test.js` parses the frontend matrix and asserts the two
 * are identical, so the drift is caught rather than discovered.
 *
 * ── IMAGES ARE GENERATED, NOT DOWNLOADED ─────────────────────────────────────
 * The catalogue seeder pulls from Unsplash. This one generates SVG and pushes it
 * through the same `media.service` the admin uploader uses, so it needs no
 * network beyond S3 and cannot fail because a photo id went away. Same reasoning
 * as the decorations seeder (§242).
 *
 *   node src/database/seeders/event-templates-matrix.seeder.js
 *   node src/database/seeders/event-templates-matrix.seeder.js --replace
 *   node src/database/seeders/event-templates-matrix.seeder.js --prod --apply
 */
require('dotenv').config({
    path: process.argv.includes('--prod') ? '.env.production' : '.env',
});

const db = require('../../models');
const mediaService = require('../../services/media.service');

const { EventTemplate, EventCategory, EventType, Religion, sequelize } = db;

const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
/** Purge every existing template first. Destructive, hence opt-in. */
const REPLACE = process.argv.includes('--replace');
const COMPANY_ID = 1;

const COMPONENT_KEYS = [
    'event_title', 'host_names', 'date_time', 'venue', 'event_qr_code', 'organizer',
    'event_photos', 'contact_details', 'invitation_message', 'social_icons',
    'footer_note', 'decoration_elements',
];
const PERMISSION_KEYS = ['background', 'colors', 'fonts', ...COMPONENT_KEYS];
const allOn = (keys) => Object.fromEntries(keys.map((k) => [k, 1]));

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* ───────────────────────────────── palettes ─────────────────────────────── */

/**
 * One palette per layout style, so a seeded row looks like the thing it claims
 * to be. Traditional in Minimal's greys would demonstrate nothing.
 */
const PALETTE = {
    classic:     { bg: '#FFF7F0', accent: '#B8860B', from: '#FCB7F3', to: '#B7C5FF', via: null },
    modern:      { bg: '#0F172A', accent: '#38BDF8', from: '#5B247A', to: '#1BCEDF', via: '#7C3AED' },
    elegant:     { bg: '#2B1B3D', accent: '#C9A227', from: '#4B1D6D', to: '#8E2DE2', via: '#FFB347' },
    minimal:     { bg: '#FAFBFC', accent: '#0D1B3D', from: '#FFF3F8', to: '#F3E8FF', via: '#E0F2FE' },
    traditional: { bg: '#8B0E1A', accent: '#D4AF37', from: '#8B1E3F', to: '#F7C873', via: '#FFF4D6' },
};

/* ──────────────────────────── the field matrix ──────────────────────────── */

/**
 * Mirrors STEP2_FIELDS in src/hooks/use-event-templates.ts.
 *
 * All five layout styles are now built from supplied screens; none is a stand-in
 * for another. Keep this table and the frontend one identical — the matrix test
 * parses both and fails on any difference.
 */
/** Elegant and Minimal share this one — both use the dropdown, not the grid. */
const IMAGE_FIELDS_MENU = ['image_upload', 'image_position_menu', 'image_scale', 'image_overlay'];
const GRADIENT_FIELDS_3 = ['gradient_type', 'gradient_direction', 'gradient_3', 'gradient_presets', 'overlay'];

const CELLS = {
    classic: {
        color: ['bg_colors', 'overlay'],
        image: ['image_upload', 'overlay', 'bg_colors'],
        gradient: ['gradient_type', 'gradient_direction', 'gradient_2', 'accent_color', 'overlay', 'gradient_presets'],
        custom: ['image_upload', 'shape', 'corner_radius', 'overlay', 'primary_colors'],
    },
    modern: {
        // Modern's Colour tab is the one Colour tab that differs: a swatch row,
        // a position control, and the overlay as a switch.
        color: ['bg_color_presets', 'bg_position_grid', 'overlay_toggle'],
        // Grid, not the dropdown Elegant and Minimal use.
        image: ['image_upload', 'image_position_grid', 'image_scale', 'image_overlay'],
        gradient: GRADIENT_FIELDS_3,
        custom: ['image_upload', 'shape', 'bg_position_grid', 'image_size_slider', 'overlay_toggle'],
    },
    elegant: {
        color: ['bg_colors', 'overlay'],
        image: IMAGE_FIELDS_MENU,
        gradient: GRADIENT_FIELDS_3,
        custom: ['image_upload', 'shape', 'bg_position_grid', 'image_size_slider', 'overlay_toggle'],
    },
    minimal: {
        color: ['bg_colors', 'overlay'],
        image: IMAGE_FIELDS_MENU,
        gradient: GRADIENT_FIELDS_3,
        custom: ['image_upload', 'bg_position_menu', 'image_size_slider', 'overlay_toggle', 'shape'],
    },
    traditional: {
        color: ['bg_colors', 'overlay'],
        image: ['image_upload', 'image_position_grid', 'image_scale', 'image_overlay'],
        gradient: GRADIENT_FIELDS_3,
        custom: ['image_upload', 'artwork_style', 'bg_position_grid', 'image_size_menu', 'overlay_toggle'],
    },
};

/**
 * A field key -> the columns it writes, and what to write.
 *
 * Every value here is deliberately NON-DEFAULT, so a test can tell "the form
 * offers this and it was saved" apart from "the column happens to hold its
 * default". Seeding `image_position: 'center'` would prove nothing.
 */
const WRITERS = {
    bg_colors: (p) => ({ background_color: p.bg, secondary_color: p.accent }),
    // Modern's swatch row writes the same column the plain hex field does.
    bg_color_presets: (p) => ({ background_color: p.bg }),
    primary_colors: (p) => ({ background_color: p.bg, secondary_color: p.accent }),
    accent_color: (p) => ({ secondary_color: p.accent }),
    overlay: () => ({ overlay_opacity: 25 }),
    image_overlay: () => ({ overlay_opacity: 35 }),
    image_upload: (p, ctx) => ({ background_image: ctx.imageUrl }),
    image_position_menu: () => ({ image_position: 'top' }),
    image_position_grid: () => ({ image_position: 'bottom-right' }),
    bg_position_menu: () => ({ background_position: 'top-left' }),
    bg_position_grid: () => ({ background_position: 'bottom' }),
    image_scale: () => ({ image_scale: 'contain' }),
    // Traditional's Custom tab labels this "Image Size" and draws a cover/contain
    // menu. Same column as image_scale — see the note in the wizard.
    image_size_menu: () => ({ image_scale: 'contain' }),
    image_size_slider: () => ({ image_size: 125 }),
    gradient_type: () => ({ gradient_type: 'linear' }),
    gradient_direction: () => ({ gradient_direction: 'bottom-right' }),
    gradient_2: (p) => ({ gradient_from: p.from, gradient_to: p.to }),
    gradient_3: (p) => ({ gradient_from: p.from, gradient_to: p.to, gradient_via: p.via }),
    // The preset row sets the same two colours a click would; it owns no column.
    gradient_presets: () => ({}),
    shape: () => ({ image_shape: 'arch' }),
    corner_radius: () => ({ corner_radius: 40 }),
    artwork_style: () => ({ artwork_style: 'patterned' }),
    overlay_toggle: () => ({ overlay_enabled: true, overlay_color: '#0B0B14', overlay_opacity: 45 }),
};

/* ─────────────────────────────── artwork ────────────────────────────────── */

/**
 * A background for the Image and Custom rows.
 *
 * Not a photograph and not trying to be: soft bands plus scattered dots in the
 * style's own palette, which reads as a designed background at thumbnail size
 * and — unlike a flat rectangle — makes it obvious when `image_position` or
 * `image_scale` actually moves something.
 */
function backgroundSvg({ bg, accent, from, to }) {
    // Sparse and low-contrast on purpose. Sample artwork competing with the
    // invitation text is how a preview ends up looking broken when nothing is
    // actually wrong with it.
    const specks = Array.from({ length: 18 }, (_, i) => {
        const x = (i * 227) % 1080;
        const y = 160 + ((i * 613) % 1600);
        const r = 3 + ((i * 5) % 7);
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="${accent}" opacity="0.10"/>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${from}" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="${bg}" stop-opacity="0.15"/>
      <stop offset="1" stop-color="${to}" stop-opacity="0.55"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.55" stop-color="${bg}" stop-opacity="0"/>
      <stop offset="1" stop-color="${bg}" stop-opacity="0.35"/>
    </radialGradient>
  </defs>
  <rect width="1080" height="1920" fill="${bg}"/>
  <rect width="1080" height="1920" fill="url(#g)"/>
  <!-- Corner marks rather than the full-width ellipses this used to draw. Those
       sat directly behind the title and the footer and turned the middle of the
       card to mud; corners stay clear of where the text goes, and still move
       visibly when image_position or image_scale changes. -->
  <path d="M0 0 L300 0 Q0 0 0 300 Z" fill="${accent}" opacity="0.22"/>
  <path d="M1080 1920 L780 1920 Q1080 1920 1080 1620 Z" fill="${accent}" opacity="0.22"/>
  ${specks}
  <rect width="1080" height="1920" fill="url(#v)"/>
</svg>`;
}

async function uploadSvg(name, body) {
    const buffer = Buffer.from(body, 'utf8');
    const stored = await mediaService.upload(
        { buffer, mimetype: 'image/svg+xml', size: buffer.length, originalname: `${slug(name)}.svg` },
        { folder: 'templates' },
        COMPANY_ID
    );
    return stored.url;
}

/* ──────────────────────────────── taxonomy ─────────────────────────────── */

const norm = (s) => String(s || '').trim().toLowerCase();

/* ───────────────────────────────── main ────────────────────────────────── */

(async () => {
    const target = PROD ? 'PRODUCTION' : 'LOCAL';
    console.log(`\n  event-templates-matrix — ${target}\n`);

    if (PROD && !APPLY) {
        console.log('  DRY RUN — production. Re-run with --apply to write.\n');
        process.exit(0);
    }

    const [cats, types, religions, frames, decos, tcats] = await Promise.all([
        EventCategory.findAll({ where: { company_id: COMPANY_ID } }),
        EventType.findAll({ where: { company_id: COMPANY_ID } }),
        Religion.findAll({ where: { company_id: COMPANY_ID } }),
        sequelize.query('SELECT id, name, template_category_id FROM frame_styles WHERE is_active = 1 ORDER BY id',
            { type: sequelize.QueryTypes.SELECT }),
        sequelize.query('SELECT id, type FROM decorations WHERE is_active = 1 ORDER BY id',
            { type: sequelize.QueryTypes.SELECT }),
        sequelize.query('SELECT id, slug FROM template_categories WHERE deleted_at IS NULL',
            { type: sequelize.QueryTypes.SELECT }),
    ]);

    const cat = cats.find((c) => norm(c.name) === 'wedding') || cats[0];
    if (!cat) { console.log('  FAIL  no event categories exist — seed the taxonomy first.\n'); process.exit(1); }
    const type = types.find((t) => t.event_category_id === cat.id) || types[0];
    if (!type) { console.log('  FAIL  no event types exist — seed the taxonomy first.\n'); process.exit(1); }
    const religion = religions.find((r) => r.event_type_id === type.id) || null;

    console.log(`  taxonomy   ${cat.name} / ${type.name}${religion ? ` / ${religion.name}` : ''}`);
    console.log(`  catalogue  ${frames.length} frames · ${decos.length} decorations · ${tcats.length} categories\n`);

    if (REPLACE) {
        // force: true — these are sample rows, and a paranoid soft delete would
        // leave `code` taken, so the very next run collides on every one of them.
        const n = await EventTemplate.count({ where: { company_id: COMPANY_ID } });
        await EventTemplate.destroy({ where: { company_id: COMPANY_ID }, force: true });
        console.log(`  purged     ${n} existing template(s)\n`);
    }

    // One background per layout style, uploaded once and shared by that style's
    // Image and Custom rows — 5 uploads rather than 10 of the same picture.
    const imageFor = {};
    for (const style of Object.keys(CELLS)) {
        imageFor[style] = await uploadSvg(`matrix-${style}`, backgroundSvg(PALETTE[style]));
        console.log(`  artwork    ${style.padEnd(12)} ${imageFor[style].split('/').pop()}`);
    }
    console.log('');

    const byType = (t) => decos.filter((d) => d.type === t).map((d) => d.id);
    let created = 0, failed = 0;

    for (const style of Object.keys(CELLS)) {
        const palette = PALETTE[style];
        const tcat = tcats.find((c) => c.slug === style) || null;
        // The frame filed under this style, so the seeded row demonstrates the
        // step-1-suggests-step-2 link rather than picking arbitrarily.
        const frame = frames.find((f) => f.template_category_id === tcat?.id) || frames[0] || null;

        for (const bg of ['color', 'image', 'gradient', 'custom']) {
            const code = `matrix-${style}-${bg}`;
            const fields = CELLS[style][bg];

            let step2 = {};
            for (const key of fields) {
                const writer = WRITERS[key];
                if (!writer) { console.log(`  FAIL    ${code.padEnd(30)} unknown field "${key}"`); failed += 1; continue; }
                step2 = { ...step2, ...writer(palette, { imageUrl: imageFor[style] }) };
            }

            const payload = {
                company_id: COMPANY_ID,
                name: `Matrix ${style[0].toUpperCase()}${style.slice(1)} · ${bg[0].toUpperCase()}${bg.slice(1)}`,
                code,
                event_category_id: cat.id,
                event_type_id: type.id,
                religion_id: religion?.id ?? null,
                template_category_id: tcat?.id ?? null,
                style,
                tags: ['matrix', style, bg],
                description: `Step 2 sample: ${style} layout, ${bg} background. Carries exactly the fields that combination's form offers.`,

                layout_style: style,
                background_type: bg,
                ...step2,

                orientation: 'portrait',
                dimension: '1080x1920',
                primary_font: 'Playfair Display',
                secondary_font: 'Poppins',

                // Real artwork, so the preview's frame and decoration layers are
                // exercised too — including `divider`, which had no render branch
                // at all until it was found by this data.
                frame_style_id: frame?.id ?? null,
                decoration_ids: [byType('corner')[0], byType('divider')[0], byType('top')[0]].filter(Boolean),

                components: allOn(COMPONENT_KEYS),
                component_order: [...COMPONENT_KEYS],
                permissions: allOn(PERMISSION_KEYS),

                status: 'published',
                is_active: 1,
                is_featured: 0,
                available_for: ['individual', 'company'],
                plan_availability: 'all',
                plan_ids: [],
                sort_order: created + 1,
                show_on_homepage: 0,
                thumbnail: imageFor[style],
            };

            const existing = await EventTemplate.findOne({ where: { code, company_id: COMPANY_ID } });
            if (existing) {
                await existing.update(payload);
                console.log(`  update  ${code.padEnd(30)} #${existing.id}  ${fields.join(' ')}`);
            } else {
                const row = await EventTemplate.create(payload);
                console.log(`  create  ${code.padEnd(30)} #${row.id}  ${fields.join(' ')}`);
            }
            created += 1;
        }
    }

    const total = await EventTemplate.count({ where: { company_id: COMPANY_ID } });
    console.log(`\n  ${created} written · ${failed} failed`);
    console.log(`  live templates now: ${total}\n`);
    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
