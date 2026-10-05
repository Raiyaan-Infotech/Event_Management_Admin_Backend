#!/usr/bin/env node
/**
 * Twenty NEW sample templates: 5 template categories x 4 template types.
 *
 *   node src/database/seeders/event-templates-sample.seeder.js                  (dry run, local)
 *   node src/database/seeders/event-templates-sample.seeder.js --apply
 *   node src/database/seeders/event-templates-sample.seeder.js --prod           (dry run, production)
 *   node src/database/seeders/event-templates-sample.seeder.js --prod --apply
 *
 * Categories (the DESIGN family — Template Categories): Classic, Royal,
 * Minimal, Elegant, Traditional. Types (a template's `background_type`):
 * Color, Image, Gradient, Custom. One template for every pair, so the client
 * portal's two filters (Design Style, Template Type) and the app's type tabs
 * each have something behind every option.
 *
 * ── IT ONLY ADDS (Jamal, 2026-10-05: "don't touch other templates") ──────────
 *   - A template is matched by its `code` (`sample-<category>-<type>`). One
 *     that already exists — live or deleted — is SKIPPED, never updated.
 *   - A category is matched by its slug. One that exists is used as it is;
 *     only a missing one is created.
 *   - No other row is read for writing, and there is no --replace.
 * So it is safe to run twice: the second run reports twenty skipped.
 *
 * ── NOT THE MATRIX SEEDER ────────────────────────────────────────�
 * `event-templates-matrix.seeder.js` also writes 5 x 4, but it exists to prove
 * the wizard's Step 2 form: every value deliberately non-default, rows named
 * "Matrix ...", and it UPDATES what it finds. These are catalogue rows a
 * client could actually pick — sensible values, real names, the fonts added
 * under Templates -> Fonts.
 *
 * ── EVERY TEMPLATE IS COMPLETE ON ITS OWN ──────────────────────────────────
 * Each category has three pieces of artwork (`event-templates-sample.artwork.js`),
 * uploaded through the same media service the admin uploader uses:
 *   a FRAME      -> a new Frame Style row ("<Category> Sample Frame"), drawn
 *                   over that category's Color and Gradient templates;
 *   a BACKGROUND -> the Image template, which carries its own border;
 *   a PATTERN    -> the Custom template, masked to an arch.
 * Nothing is borrowed from the existing frames or decorations: those are
 * whatever has been uploaded on this database (birthday bulbs, a mosque
 * silhouette…), and picking "the first corner" from them is how a wedding
 * template ends up with balloons on it.
 *
 * A frame is matched by its name like a category by its slug: one that exists
 * is reused, never changed.
 */
require('dotenv').config({
    path: process.argv.includes('--prod') ? '.env.production' : '.env',
});

const db = require('../../models');
const mediaService = require('../../services/media.service');
const ARTWORK = require('./event-templates-sample.artwork');

const { EventTemplate, EventCategory, TemplateCategory, FrameStyle } = db;

const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const COMPANY_ID = 1;

/** MUST match COMPONENT_KEYS in eventTemplate.service.js. */
const COMPONENT_KEYS = [
    'event_title', 'host_names', 'date_time', 'venue', 'event_qr_code', 'organizer',
    'event_photos', 'contact_details', 'invitation_message',
    'footer_note', 'decoration_elements',
];
const PERMISSION_KEYS = ['background', 'colors', 'fonts', ...COMPONENT_KEYS];
const allOn = (keys) => Object.fromEntries(keys.map((k) => [k, 1]));

/** The layout styles the wizard has a bespoke Step 2 for; any other uses Classic's. */
const LAYOUT_STYLES = ['classic', 'modern', 'elegant', 'minimal', 'traditional'];

/**
 * The five categories, each with its own palette and fonts so a row looks
 * like what it is called. `primary` fonts are ones the fonts seeder adds
 * (Templates -> Fonts); a database without them draws the names in a default
 * face and loses nothing else.
 */
const CATEGORIES = [
    {
        slug: 'classic', name: 'Classic',
        bg: '#FFF8EF', accent: '#9C6B1F', from: '#FCE8D5', via: null, to: '#F6D9E4',
        primary: 'Parisienne', secondary: 'Lora',
    },
    {
        slug: 'royal', name: 'Royal',
        bg: '#14213D', accent: '#E0B03A', from: '#0B1736', via: '#3B2A6B', to: '#7A1F3D',
        primary: 'Pinyon Script', secondary: 'Cinzel',
    },
    {
        slug: 'minimal', name: 'Minimal',
        bg: '#FAFAF7', accent: '#2F3A4A', from: '#F4F1EA', via: null, to: '#E3ECF2',
        primary: 'Libre Baskerville', secondary: 'Josefin Sans',
    },
    {
        slug: 'elegant', name: 'Elegant',
        bg: '#2B1B3D', accent: '#D9B26A', from: '#3A1F5C', via: '#7B3FA0', to: '#E7A977',
        primary: 'Allura', secondary: 'Cormorant Garamond',
    },
    {
        slug: 'traditional', name: 'Traditional',
        bg: '#7A1220', accent: '#E6BE5A', from: '#7A1220', via: '#B5451F', to: '#F2C66B',
        primary: 'Alex Brush', secondary: 'Marcellus',
    },
];

/** The four types, in the admin form's order, and the word each adds to a name. */
const TYPES = [
    { value: 'color', label: 'Color' },
    { value: 'image', label: 'Image' },
    { value: 'gradient', label: 'Gradient' },
    { value: 'custom', label: 'Custom' },
];

/** The columns one type fills. Sensible values — what a designer would leave them at. */
const columnsFor = (type, c, imageUrl) => {
    switch (type) {
        case 'color':
            return { background_color: c.bg, secondary_color: c.accent, overlay_opacity: 0 };
        case 'image':
            return {
                background_image: imageUrl, background_color: c.bg, secondary_color: c.accent,
                image_position: 'center', image_scale: 'cover', overlay_opacity: 0,
            };
        case 'gradient':
            return {
                gradient_type: 'linear', gradient_direction: 'bottom',
                gradient_from: c.from, gradient_via: c.via, gradient_to: c.to,
                background_color: c.bg, secondary_color: c.accent, overlay_opacity: 0,
            };
        case 'custom':
            return {
                background_image: imageUrl, background_color: c.bg, secondary_color: c.accent,
                image_shape: 'arch', background_position: 'center', overlay_opacity: 0,
            };
        default:
            return {};
    }
};

const uploadSvg = async (name, body) => {
    const buffer = Buffer.from(body, 'utf8');
    const stored = await mediaService.upload(
        { buffer, mimetype: 'image/svg+xml', size: buffer.length, originalname: `${name}.svg` },
        { folder: 'templates' },
        COMPANY_ID
    );
    return stored.url;
};

(async () => {
    console.log(`\n  event-templates-sample — ${PROD ? 'PRODUCTION' : 'LOCAL'}${APPLY ? '' : '  (DRY RUN)'}\n`);

    const frameName = (c) => `${c.name} Sample Frame`;

    const [eventCategories, templateCategories, frames, existing, maxSort] = await Promise.all([
        EventCategory.findAll({ where: { company_id: COMPANY_ID }, attributes: ['id', 'name'] }),
        TemplateCategory.findAll({ where: { company_id: COMPANY_ID } }),
        FrameStyle.findAll({ where: { company_id: COMPANY_ID, name: CATEGORIES.map(frameName) } }),
        // paranoid: false — a soft-deleted row still holds its `code`.
        EventTemplate.findAll({
            where: { company_id: COMPANY_ID, code: CATEGORIES.flatMap((c) => TYPES.map((t) => `sample-${c.slug}-${t.value}`)) },
            attributes: ['id', 'code'],
            paranoid: false,
        }),
        EventTemplate.max('sort_order', { where: { company_id: COMPANY_ID } }),
    ]);

    const eventCategory =
        eventCategories.find((c) => String(c.name).trim().toLowerCase() === 'wedding') || eventCategories[0];
    if (!eventCategory) {
        console.log('  FAIL  no event categories exist — seed the taxonomy first.\n');
        process.exit(1);
    }
    console.log(`  event category   ${eventCategory.name} (#${eventCategory.id})`);

    const taken = new Set(existing.map((r) => r.code));
    const haveCategory = new Map(templateCategories.map((c) => [c.slug, c]));
    const missingCategories = CATEGORIES.filter((c) => !haveCategory.has(c.slug));

    console.log(`  categories       ${CATEGORIES.length - missingCategories.length} exist, ${missingCategories.length} to create`
        + (missingCategories.length ? `  (${missingCategories.map((c) => c.name).join(', ')})` : ''));
    console.log(`  frames           ${frames.length} exist, ${CATEGORIES.length - frames.length} to upload`);
    console.log(`  types            ${TYPES.map((t) => t.label).join(', ')}`);
    console.log(`  templates        ${taken.size} exist (skipped), ${CATEGORIES.length * TYPES.length - taken.size} to create\n`);

    if (!APPLY) {
        for (const c of CATEGORIES) {
            for (const t of TYPES) {
                const code = `sample-${c.slug}-${t.value}`;
                console.log(`  ${taken.has(code) ? 'skip  ' : 'create'}  ${code.padEnd(28)} ${c.name} ${t.label}`);
            }
        }
        console.log('\n  Dry run — nothing changed. Re-run with --apply.\n');
        process.exit(0);
    }

    // Categories first: only the missing ones, after the last existing one.
    let categorySort = templateCategories.reduce((m, c) => Math.max(m, Number(c.sort_order) || 0), 0);
    for (const c of missingCategories) {
        categorySort += 1;
        const row = await TemplateCategory.create({
            company_id: COMPANY_ID, name: c.name, slug: c.slug, sort_order: categorySort, is_active: 1,
        });
        haveCategory.set(c.slug, row);
        console.log(`  category  create  ${c.name} (#${row.id})`);
    }

    const haveFrame = new Map(frames.map((f) => [f.name, f]));
    let sort = Number(maxSort) || 0;
    let created = 0;
    let skipped = 0;

    for (const c of CATEGORIES) {
        const category = haveCategory.get(c.slug);
        const todo = TYPES.filter((t) => !taken.has(`sample-${c.slug}-${t.value}`));
        skipped += TYPES.length - todo.length;
        if (!todo.length) continue;

        // Uploaded only when a row that needs it is about to be created.
        const art = ARTWORK[c.slug];
        const needs = (type) => todo.some((t) => t.value === type);
        const imageUrl = needs('image') ? await uploadSvg(`sample-${c.slug}-background`, art.image()) : null;
        const customUrl = needs('custom') ? await uploadSvg(`sample-${c.slug}-pattern`, art.custom()) : null;

        // This category's own frame, for its Color and Gradient templates.
        let frame = haveFrame.get(frameName(c)) || null;
        if (!frame && (needs('color') || needs('gradient'))) {
            const fileName = `sample-${c.slug}-frame.svg`;
            frame = await FrameStyle.create({
                company_id: COMPANY_ID,
                name: frameName(c),
                template_category_id: category.id,
                file_url: await uploadSvg(`sample-${c.slug}-frame`, art.frame()),
                file_name: fileName,
                supported_layouts: ['portrait'],
                status: 'published',
                is_active: 1,
            });
            haveFrame.set(frame.name, frame);
            console.log(`  frame     create  ${frame.name} (#${frame.id})`);
        }

        for (const t of todo) {
            const code = `sample-${c.slug}-${t.value}`;
            sort += 1;
            const row = await EventTemplate.create({
                company_id: COMPANY_ID,
                name: `${c.name} ${t.label}`,
                code,
                event_category_id: eventCategory.id,
                template_category_id: category.id,
                style: c.slug,
                tags: ['sample', c.slug, t.value],
                description: `${c.name} design with a ${t.label.toLowerCase()} background.`,

                layout_style: LAYOUT_STYLES.includes(c.slug) ? c.slug : 'classic',
                background_type: t.value,
                ...columnsFor(t.value, c, t.value === 'custom' ? customUrl : imageUrl),

                orientation: 'portrait',
                dimension: '1080x1920',
                primary_font: c.primary,
                secondary_font: c.secondary,

                // The frame goes on the flat backgrounds only: the Image
                // artwork has its border drawn in, and the Custom design is
                // masked to an arch a rectangular frame would cut across.
                frame_style_id: t.value === 'color' || t.value === 'gradient' ? (frame?.id ?? null) : null,
                decoration_ids: [],

                components: allOn(COMPONENT_KEYS),
                component_order: [...COMPONENT_KEYS],
                permissions: allOn(PERMISSION_KEYS),

                status: 'published',
                is_active: 1,
                is_featured: 0,
                available_for: ['individual', 'company'],
                plan_availability: 'all',
                plan_ids: [],
                sort_order: sort,
                show_on_homepage: 0,
                // The Image and Custom rows show their artwork; the others are
                // drawn live from their colours, which a thumbnail would hide.
                thumbnail: t.value === 'image' ? imageUrl : t.value === 'custom' ? customUrl : null,
            });
            created += 1;
            console.log(`  template  create  ${code.padEnd(28)} #${row.id}  ${row.name}`);
        }
    }

    const total = await EventTemplate.count({ where: { company_id: COMPANY_ID } });
    console.log(`\n  ${created} created · ${skipped} skipped (already there)`);
    console.log(`  live templates now: ${total}\n`);
    process.exit(0);
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
