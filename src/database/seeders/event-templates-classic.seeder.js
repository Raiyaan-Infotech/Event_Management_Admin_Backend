#!/usr/bin/env node
/**
 * Four finished Classic templates — one per template type.
 *
 *   node src/database/seeders/event-templates-classic.seeder.js                  (dry run, local)
 *   node src/database/seeders/event-templates-classic.seeder.js --apply
 *   node src/database/seeders/event-templates-classic.seeder.js --prod           (dry run, production)
 *   node src/database/seeders/event-templates-classic.seeder.js --prod --apply
 *   ... --apply --refresh    also rewrites these templates (and only these)
 *   ... --only=<code>        one template, e.g. --only=classic-emerald-gala
 *
 *   Royal Plum        Color      plum, ivory words · Fine Rule Floral Gold
 *   Dutch Bloom       Image      a 17th-century flower painting under a shade · Heritage Trophy Gold
 *   Ivory Poppy       Gradient   ivory to champagne, navy words · Nouveau Poppy Bronze
 *   Couple Portrait   Custom     the host's own photograph (sample: a couple) under a shade,
 *                                cream words · Fleur Border Gold
 *
 * ── REAL ARTWORK, NOT GENERATED ────────────────────────────────────────────
 * (Jamal, 2026-10-06: anything drawn by code "looks AI generated".)
 *   - The frames are public-domain engravings and Art Nouveau borders from
 *     Wikimedia Commons, already in Templates → Frame Styles
 *     (`frame-styles-vintage.seeder.js` adds them — run it first on a
 *     database that does not have them; this seeder stops and names what is
 *     missing). The Heritage frames are uploaded here if absent.
 *   - The two pictures are public-domain paintings, in `assets/`:
 *       classic-dutch-bloom.jpg  Rachel Ruysch, flower still life (National
 *                                Gallery of Ireland) — Commons, "Public domain"
 *       classic-rose-plate.jpg   P.-J. Redouté, Rosa centifolia foliacea, from
 *                                Les Roses — Commons, "Public domain"
 *     No photographs of people: nothing to replace before selling these.
 *   - No decorations: the frame and the picture are the ornament.
 *
 * ── IT ONLY ADDS ───────────────────────────────────────────────────────────
 * A template is matched by its `code`; one that exists — live or deleted — is
 * skipped, never updated. `--refresh` rewrites the design of the templates
 * named here (live rows only) and discards edits made to them in the admin.
 *
 * ── THE TWO PHOTOGRAPHS ARE SAMPLES ────────────────────────────────────────
 * `assets/classic-bridal-portrait.jpg`  Unsplash, Tasnim Chowdhury (ojJDGZafBHA)
 * `assets/classic-couple-portrait.jpg`  Unsplash, ARTO SURAJ (kp7XkkCLnlY)
 * The Unsplash licence allows commercial use, but these show identifiable
 * people with no model release. Replace them with photographs the business
 * owns before the templates are sold.
 */
require('dotenv').config({
    path: process.argv.includes('--prod') ? '.env.production' : '.env',
});

const fs = require('fs');
const path = require('path');
const db = require('../../models');
const mediaService = require('../../services/media.service');
const ART = require('./event-templates-classic.artwork');

const { EventTemplate, EventCategory, TemplateCategory, FrameStyle, Decoration } = db;

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

/** `shown`, in reading order, are on; every other section is off and goes last. */
const sections = (shown) => ({
    components: Object.fromEntries(COMPONENT_KEYS.map((k) => [k, shown.includes(k) ? 1 : 0])),
    component_order: [...shown, ...COMPONENT_KEYS.filter((k) => !shown.includes(k))],
});

/** The frames this seeder adds — see the header for where each drawing comes from. */
const OWN_FRAMES = {
    'Heritage Scroll Gold': 'assets/heritage-scroll-gold.png',
    'Heritage Scroll Cream': 'assets/heritage-scroll-cream.png',
    'Heritage Trophy Gold': 'assets/heritage-trophy-gold.png',
    'Nouveau Foliage Bronze': 'assets/nouveau-foliage-bronze.png',
};

/** None of these templates uses a decoration; kept so one can be added by name. */
const OWN_DECORATIONS = {
    'Gold Diamond Rule': { type: 'divider', file: 'gold-diamond-rule', art: () => ART.rule('#E6C77A') },
};

/**
 * Five rows on every card — title & names, date, venue, QR — because a frame's
 * window is smaller than a bare card and an invitation reads better with room
 * round the names. The host can switch the rest on.
 */
const ROWS = ['event_title', 'host_names', 'date_time', 'venue', 'event_qr_code'];

const ALL_TEMPLATES = [
    {
        // Plum and gold. The words take the Secondary Color (ivory); the
        // frame keeps its own gold. Names a little larger than standard.
        code: 'classic-royal-plum',
        name: 'Royal Plum',
        description: 'Deep plum with ivory lettering inside a fine gold floral rule.',
        tags: ['classic', 'plum', 'gold', 'formal'],
        background_type: 'color',
        frame: 'Fine Rule Floral Gold',
        columns: {
            background_color: '#591D4E', secondary_color: '#F6E7C8', overlay_opacity: 0,
            primary_font_size: 115, secondary_font_size: 105,
        },
        primary_font: 'Pinyon Script',
        secondary_font: 'Cormorant Garamond',
        ...sections(ROWS),
    },
    {
        // A Dutch flower painting in a gilded frame. The shade keeps cream
        // words readable over it; `background_color` is the tone the text
        // colour is worked out against.
        code: 'classic-dutch-bloom',
        name: 'Dutch Bloom',
        description: 'A seventeenth-century flower painting in an engraved gold frame, with cream lettering.',
        tags: ['classic', 'floral', 'painting', 'gold'],
        background_type: 'image',
        photo: { file: 'classic-dutch-bloom', path: 'assets/classic-dutch-bloom.jpg' },
        frame: 'Heritage Trophy Gold',
        columns: {
            background_color: '#1E1A14', secondary_color: '#F6E7C8',
            image_position: 'center', image_scale: 'cover', overlay_opacity: 50,
            primary_font_size: 110, secondary_font_size: 105,
        },
        primary_font: 'Rouge Script',
        secondary_font: 'Cormorant Garamond',
        ...sections(ROWS),
    },
    {
        // The light one: ivory fading to champagne, navy words, and a bronze
        // Art Nouveau poppy border.
        code: 'classic-ivory-poppy',
        name: 'Ivory Poppy',
        description: 'Ivory fading to champagne with navy lettering and an Art Nouveau poppy border.',
        tags: ['classic', 'ivory', 'champagne', 'floral'],
        background_type: 'gradient',
        frame: 'Nouveau Poppy Bronze',
        columns: {
            gradient_type: 'linear', gradient_direction: 'bottom',
            gradient_from: '#FDF8F0', gradient_via: null, gradient_to: '#F5E6C8',
            background_color: '#F9EFDC', secondary_color: '#1C3557', overlay_opacity: 0,
        },
        primary_font: 'Playfair Display',
        secondary_font: 'EB Garamond',
        ...sections(ROWS),
    },
    {
        // A Custom template is where the HOST'S OWN PHOTOGRAPH goes, so its
        // sample has to be a couple's photograph — that is what the host is
        // being shown (Jamal, 2026-10-06; a flower plate here was wrong). The
        // shade keeps cream words readable over whatever picture is uploaded;
        // heavier than the Image template's, since nobody knows how busy that
        // picture will be. Event Photos stays ON — on a custom template that
        // switch is what shows the host's picture.
        //
        // The photograph is a free Unsplash one (ARTO SURAJ,
        // unsplash.com/photos/kp7XkkCLnlY) of identifiable people with no
        // model release — a SAMPLE. Replace it with a picture the business
        // owns before selling the template.
        code: 'classic-couple-portrait',
        name: 'Couple Portrait',
        description: 'Your own photograph in a gold fleur border, with cream lettering.',
        tags: ['classic', 'photo', 'couple', 'gold'],
        background_type: 'custom',
        photo: { file: 'classic-couple-portrait', path: 'assets/classic-couple-portrait.jpg' },
        frame: 'Fleur Border Gold',
        columns: {
            background_color: '#3A2420', secondary_color: '#F8E9C4',
            image_shape: 'rectangle', corner_radius: 0, background_position: 'center',
            overlay_opacity: 55,
            primary_font_size: 110,
        },
        primary_font: 'Italianno',
        secondary_font: 'EB Garamond',
        ...sections([...ROWS, 'event_photos']),
    },
];

const TEMPLATES = ONLY ? ALL_TEMPLATES.filter((t) => t.code === ONLY) : ALL_TEMPLATES;
if (ONLY && TEMPLATES.length === 0) {
    console.error(`No template with the code "${ONLY}" in this seeder.`);
    process.exit(1);
}

const upload = async (name, buffer, mimetype, extension) => {
    const stored = await mediaService.upload(
        { buffer, mimetype, size: buffer.length, originalname: `${name}.${extension}` },
        { folder: 'templates' },
        COMPANY_ID
    );
    return stored.url;
};

(async () => {
    console.log(`\n  event-templates-classic — ${PROD ? 'PRODUCTION' : 'LOCAL'}${APPLY ? '' : '  (DRY RUN)'}\n`);

    const frameNames = [...new Set(TEMPLATES.map((t) => t.frame).filter(Boolean))];
    const decorationNames = [...new Set(TEMPLATES.flatMap((t) => t.decorations ?? []))];

    const [eventCategories, classic, frames, decorations, existing, maxSort] = await Promise.all([
        EventCategory.findAll({ where: { company_id: COMPANY_ID }, attributes: ['id', 'name'] }),
        TemplateCategory.findOne({ where: { company_id: COMPANY_ID, slug: 'classic' } }),
        FrameStyle.findAll({ where: { company_id: COMPANY_ID, name: frameNames } }),
        Decoration.findAll({ where: { company_id: COMPANY_ID, name: decorationNames } }),
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
    if (!eventCategory) {
        console.log('  FAIL  no event categories exist — seed the taxonomy first.\n');
        process.exit(1);
    }

    const haveFrame = new Map(frames.map((f) => [f.name, f]));
    const haveDecoration = new Map(decorations.map((d) => [d.name, d]));

    // Nothing is written until every catalogue piece is accounted for.
    const missing = [
        ...frameNames.filter((n) => !haveFrame.has(n) && !OWN_FRAMES[n]).map((n) => `frame style "${n}"`),
        ...decorationNames
            .filter((n) => !haveDecoration.has(n) && !OWN_DECORATIONS[n])
            .map((n) => `decoration "${n}"`),
    ];
    if (missing.length) {
        console.log(`  FAIL  not in this database's catalogue: ${missing.join(', ')}.\n`);
        process.exit(1);
    }

    const taken = new Set(existing.map((r) => r.code));
    // --refresh rewrites a LIVE row; a deleted one is still only skipped.
    const live = new Map(existing.filter((r) => !r.deleted_at).map((r) => [r.code, r]));
    const action = (t) => (!taken.has(t.code) ? 'create' : REFRESH && live.has(t.code) ? 'update' : 'skip  ');
    const todo = TEMPLATES.filter((t) => action(t) !== 'skip  ');

    console.log(`  event category   ${eventCategory.name} (#${eventCategory.id})`);
    console.log(`  Classic category ${classic ? `exists (#${classic.id})` : 'to create'}`);
    console.log(`  frames           ${frames.length} of ${frameNames.length} found`);
    console.log(`  decorations      ${decorations.length} found, ${decorationNames.length - decorations.length} to upload`);
    for (const t of TEMPLATES) {
        console.log(`  ${action(t)}  ${t.code.padEnd(26)} ${t.name} (${t.background_type}) · ${t.frame}`);
    }

    if (!APPLY) {
        console.log('\n  Dry run — nothing changed. Re-run with --apply.\n');
        process.exit(0);
    }
    console.log('');

    let category = classic;
    if (!category) {
        const last = await TemplateCategory.max('sort_order', { where: { company_id: COMPANY_ID } });
        category = await TemplateCategory.create({
            company_id: COMPANY_ID, name: 'Classic', slug: 'classic',
            sort_order: (Number(last) || 0) + 1, is_active: 1,
        });
        console.log(`  category  create  Classic (#${category.id})`);
    }

    let sort = Number(maxSort) || 0;
    let written = 0;

    for (const t of todo) {
        if (t.frame && !haveFrame.has(t.frame)) {
            const file = path.basename(OWN_FRAMES[t.frame]);
            const frame = await FrameStyle.create({
                company_id: COMPANY_ID,
                name: t.frame,
                template_category_id: category.id,
                file_url: await upload(
                    file.replace(/\.png$/, ''),
                    fs.readFileSync(path.join(__dirname, OWN_FRAMES[t.frame])),
                    'image/png',
                    'png'
                ),
                file_name: file,
                supported_layouts: ['portrait'],
                status: 'published',
                is_active: 1,
            });
            haveFrame.set(frame.name, frame);
            console.log(`  frame     create  ${frame.name} (#${frame.id})`);
        }

        const decorationIds = [];
        for (const name of t.decorations ?? []) {
            let decoration = haveDecoration.get(name) || null;
            if (!decoration) {
                const spec = OWN_DECORATIONS[name];
                const body = Buffer.from(spec.art(), 'utf8');
                decoration = await Decoration.create({
                    company_id: COMPANY_ID,
                    name,
                    type: spec.type,
                    file_url: await upload(spec.file, body, 'image/svg+xml', 'svg'),
                    file_name: `${spec.file}.svg`,
                    file_format: 'SVG',
                    file_size: body.length,
                    is_active: 1,
                });
                haveDecoration.set(name, decoration);
                console.log(`  decor     create  ${name} (#${decoration.id}, ${spec.type})`);
            }
            decorationIds.push(decoration.id);
        }

        const current = live.get(t.code) || null;
        // A refreshed row keeps the picture it already has — nothing new to upload.
        const imageUrl = t.photo && !current
            ? await upload(t.photo.file, fs.readFileSync(path.join(__dirname, t.photo.path)), 'image/jpeg', 'jpg')
            : null;

        const design = {
            name: t.name,
            event_category_id: eventCategory.id,
            template_category_id: category.id,
            style: 'classic',
            tags: t.tags,
            description: t.description,

            layout_style: 'classic',
            background_type: t.background_type,
            ...t.columns,
            ...(imageUrl ? { background_image: imageUrl } : {}),

            orientation: 'portrait',
            dimension: '1080x1920',
            primary_font: t.primary_font,
            secondary_font: t.secondary_font,
            frame_style_id: haveFrame.get(t.frame)?.id ?? null,
            decoration_ids: decorationIds,

            components: t.components,
            component_order: t.component_order,
            permissions: allOn(PERMISSION_KEYS),
        };

        if (current) {
            await EventTemplate.update(design, { where: { id: current.id } });
            written += 1;
            console.log(`  template  update  ${t.code.padEnd(26)} #${current.id}  ${t.name}`);
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
        written += 1;
        console.log(`  template  create  ${t.code.padEnd(26)} #${row.id}  ${row.name}`);
    }

    const total = await EventTemplate.count({ where: { company_id: COMPANY_ID } });
    console.log(`\n  ${written} written · ${TEMPLATES.length - written} skipped (already there)`);
    console.log(`  live templates now: ${total}\n`);
    process.exit(0);
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
