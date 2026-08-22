/**
 * Sample data for Template Categories + Frame Styles.
 *
 *      node src/database/seeders/frame-styles.seeder.js
 *      node src/database/seeders/frame-styles.seeder.js --force
 *      node src/database/seeders/frame-styles.seeder.js --prod --apply
 *
 * Creates the five categories — Classic, Royal, Minimal, Elegant, Traditional —
 * and two frame styles under each, uploaded through the real media service.
 *
 * ── WHY THE ARTWORK IS GENERATED AND NOT DOWNLOADED ──────────────────────────
 * The obvious move is to pull images off Unsplash, which is what
 * `event-templates.seeder.js` does for its BACKGROUNDS. It cannot work here.
 *
 * Unsplash is stock photography. A frame is not a picture that sits behind the
 * invitation — it is artwork laid OVER it, and everything that is not the
 * border has to be transparent so the names and the date show through. A
 * downloaded photograph is an opaque rectangle: dropped into the frame slot it
 * covers the invitation completely, and all ten samples would look identical
 * and broken.
 *
 * So each frame is a real SVG built here, with an actual transparent middle.
 * They are genuine placeholder ARTWORK rather than genuine placeholder BYTES,
 * which is the part that matters for judging the module.
 *
 * Replacing any of them later is an upload on the Frame Styles screen; nothing
 * in the schema knows these were generated.
 *
 * ── EVERYTHING GOES THROUGH media.service ────────────────────────────────────
 * Same reason the templates seeder does it: the file lands wherever the admin
 * panel's own uploads land, and a broken storage config fails loudly here
 * rather than quietly on the first real upload.
 *
 * Idempotent — existing rows are skipped by name, `--force` rewrites them.
 */

require('dotenv').config({
    path: process.argv.includes('--prod') ? '.env.production' : '.env',
});

const db = require('../../models');
const mediaService = require('../../services/media.service');
const categoryService = require('../../services/templateCategory.service');

const FORCE = process.argv.includes('--force');
const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const TARGET = PROD ? 'PRODUCTION' : 'LOCAL';
const COMPANY_ID = 1;

/* ------------------------------------------------------------ the artwork -- */

/**
 * Every frame is drawn on the same 600x800 canvas with `preserveAspectRatio`
 * left at its default, so `object-fill` in the preview stretches it to whatever
 * card it is laid over — which is what a border has to do.
 *
 * `fill="none"` on the backdrop is the whole point: the middle must stay
 * transparent or the frame hides the invitation.
 */
const canvas = (body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">` +
    `<rect width="600" height="800" fill="none"/>${body}</svg>`;

const GOLD = '#C9A227';
const DEEP = '#8A6A3B';
const ROSE = '#B23A48';

/** Classic — plain double rule. The restrained one. */
const classicDouble = canvas(`
  <rect x="26" y="26" width="548" height="748" fill="none" stroke="${DEEP}" stroke-width="6"/>
  <rect x="42" y="42" width="516" height="716" fill="none" stroke="${DEEP}" stroke-width="2"/>
`);

/** Classic — squared corner keys. */
const classicKeyline = canvas(`
  <rect x="30" y="30" width="540" height="740" fill="none" stroke="${DEEP}" stroke-width="3"/>
  ${[[30, 30, 1, 1], [570, 30, -1, 1], [30, 770, 1, -1], [570, 770, -1, -1]]
        .map(([x, y, sx, sy]) =>
            `<path d="M${x} ${y + 54 * sy} L${x} ${y} L${x + 54 * sx} ${y}" fill="none" stroke="${DEEP}" stroke-width="10"/>`)
        .join('')}
`);

/** Royal — heavy gold band with crowned corner flourishes. */
const royalCrest = canvas(`
  <rect x="18" y="18" width="564" height="764" fill="none" stroke="${GOLD}" stroke-width="12"/>
  <rect x="40" y="40" width="520" height="720" fill="none" stroke="${GOLD}" stroke-width="2"/>
  ${[[40, 40, 1, 1], [560, 40, -1, 1], [40, 760, 1, -1], [560, 760, -1, -1]]
        .map(([x, y, sx, sy]) => `
    <path d="M${x} ${y + 70 * sy} Q${x} ${y} ${x + 70 * sx} ${y}" fill="none" stroke="${GOLD}" stroke-width="7"/>
    <circle cx="${x + 26 * sx}" cy="${y + 26 * sy}" r="7" fill="${GOLD}"/>
    <path d="M${x + 44 * sx} ${y + 12 * sy} l${10 * sx} ${14 * sy} l${14 * sx} ${-8 * sy}" fill="none" stroke="${GOLD}" stroke-width="4"/>`)
        .join('')}
  <path d="M270 18 L300 44 L330 18" fill="none" stroke="${GOLD}" stroke-width="7"/>
  <path d="M270 782 L300 756 L330 782" fill="none" stroke="${GOLD}" stroke-width="7"/>
`);

/** Royal — damask-style repeating band. */
const royalDamask = canvas(`
  <rect x="22" y="22" width="556" height="756" fill="none" stroke="${GOLD}" stroke-width="9"/>
  <rect x="46" y="46" width="508" height="708" fill="none" stroke="${GOLD}" stroke-width="2"/>
  ${Array.from({ length: 9 }, (_, i) => 70 + i * 60)
        .map((x) => `<path d="M${x} 34 l14 -14 l14 14 l-14 14 z" fill="${GOLD}" opacity="0.85"/>
                     <path d="M${x} 766 l14 -14 l14 14 l-14 14 z" fill="${GOLD}" opacity="0.85"/>`)
        .join('')}
  ${Array.from({ length: 11 }, (_, i) => 100 + i * 60)
        .map((y) => `<path d="M34 ${y} l-14 14 l14 14 l14 -14 z" fill="${GOLD}" opacity="0.85"/>
                     <path d="M566 ${y} l-14 14 l14 14 l14 -14 z" fill="${GOLD}" opacity="0.85"/>`)
        .join('')}
`);

/** Minimal — a single hairline. */
const minimalHairline = canvas(`
  <rect x="34" y="34" width="532" height="732" fill="none" stroke="${DEEP}" stroke-width="2"/>
`);

/** Minimal — corner ticks only, no continuous border. */
const minimalTicks = canvas(`
  ${[[40, 40, 1, 1], [560, 40, -1, 1], [40, 760, 1, -1], [560, 760, -1, -1]]
        .map(([x, y, sx, sy]) =>
            `<path d="M${x} ${y + 46 * sy} L${x} ${y} L${x + 46 * sx} ${y}" fill="none" stroke="${DEEP}" stroke-width="2.5"/>`)
        .join('')}
`);

/**
 * Elegant — arched top with a thin flourish.
 *
 * A true semicircular cap (A260 260) rather than a quadratic pull toward the
 * top edge: the first version curved from y=250 all the way to y=40 and read as
 * a stadium/pill, not an arch. The base closes at y=752 so the flourish sits
 * INSIDE the frame instead of being clipped by the card edge.
 */
const elegantArch = canvas(`
  <path d="M40 752 L40 300 A260 260 0 0 1 560 300 L560 752 Z"
        fill="none" stroke="${DEEP}" stroke-width="4"/>
  <path d="M58 734 L58 300 A242 242 0 0 1 542 300 L542 734 Z"
        fill="none" stroke="${DEEP}" stroke-width="1.5" opacity="0.65"/>
  <circle cx="300" cy="40" r="6" fill="${DEEP}"/>
  <path d="M240 706 Q300 682 360 706" fill="none" stroke="${DEEP}" stroke-width="3"/>
  <circle cx="300" cy="692" r="4" fill="${DEEP}"/>
`);

/** Elegant — thin frame with a scripted rule top and bottom. */
const elegantRule = canvas(`
  <rect x="36" y="36" width="528" height="728" fill="none" stroke="${DEEP}" stroke-width="2"/>
  <path d="M170 76 Q230 56 300 76 Q370 96 430 76" fill="none" stroke="${DEEP}" stroke-width="2.5"/>
  <path d="M170 724 Q230 744 300 724 Q370 704 430 724" fill="none" stroke="${DEEP}" stroke-width="2.5"/>
  <circle cx="300" cy="76" r="4" fill="${DEEP}"/>
  <circle cx="300" cy="724" r="4" fill="${DEEP}"/>
`);

/** Traditional — toran-style hanging border along the top. */
const traditionalToran = canvas(`
  <rect x="28" y="28" width="544" height="744" fill="none" stroke="${ROSE}" stroke-width="5"/>
  <rect x="46" y="46" width="508" height="708" fill="none" stroke="${GOLD}" stroke-width="2"/>
  ${Array.from({ length: 10 }, (_, i) => 62 + i * 48)
        .map((x) => `<path d="M${x} 46 q12 32 24 0" fill="none" stroke="${GOLD}" stroke-width="3.5"/>
                     <circle cx="${x + 12}" cy="86" r="4.5" fill="${ROSE}"/>`)
        .join('')}
  ${/* Drawn UP from y=754, not down: hanging them off the outer edge put half
        of every scallop outside the canvas, where it was clipped away. */
        Array.from({ length: 10 }, (_, i) => 62 + i * 48)
            .map((x) => `<path d="M${x} 754 q12 -32 24 0" fill="none" stroke="${GOLD}" stroke-width="3.5"/>
                         <circle cx="${x + 12}" cy="714" r="4.5" fill="${ROSE}"/>`)
            .join('')}
`);

/**
 * Traditional — mandala quarter in each corner.
 *
 * The first version drew ONE arc per corner at a large radius, which is exactly
 * the geometry of a rounded rectangle — so it read as a plain rounded border and
 * nothing about it said mandala. Three concentric arcs at a tighter radius, with
 * rays spanning the full gap and a petal ring between them, reads as an ornament
 * sitting in the corner instead.
 */
const traditionalMandala = canvas(`
  <rect x="30" y="30" width="540" height="740" fill="none" stroke="${GOLD}" stroke-width="3"/>
  ${[[30, 30, 1, 1], [570, 30, -1, 1], [30, 770, 1, -1], [570, 770, -1, -1]]
        .map(([x, y, sx, sy]) => {
            // sweep flips with the corner, or the arc bulges into the card.
            const sweep = sx * sy > 0 ? 1 : 0;
            const arc = (r, stroke, w) =>
                `<path d="M${x} ${y + r * sy} A${r} ${r} 0 0 ${sweep} ${x + r * sx} ${y}"
                       fill="none" stroke="${stroke}" stroke-width="${w}"/>`;
            const rays = Array.from({ length: 7 }, (_, i) => {
                const a = (i * Math.PI) / 12;
                const c = Math.cos(a);
                const s2 = Math.sin(a);
                return `<line x1="${x + 30 * sx * c}" y1="${y + 30 * sy * s2}"
                              x2="${x + 74 * sx * c}" y2="${y + 74 * sy * s2}"
                              stroke="${GOLD}" stroke-width="2"/>`;
            }).join('');
            const petals = Array.from({ length: 4 }, (_, i) => {
                const a = (Math.PI / 8) + (i * Math.PI) / 8;
                return `<circle cx="${x + 52 * sx * Math.cos(a)}" cy="${y + 52 * sy * Math.sin(a)}"
                                r="5" fill="${ROSE}"/>`;
            }).join('');
            return arc(74, ROSE, 4) + arc(52, GOLD, 2) + arc(30, ROSE, 2.5) + rays + petals;
        })
        .join('')}
`);

/* ------------------------------------------------------------- the sample -- */

/**
 * Categories are resolved BY NAME at runtime, never by hardcoded id — ids differ
 * between local and production, and an id-based seeder files a Royal frame under
 * Minimal. Same rule `event-templates.seeder.js` follows.
 */
const CATEGORIES = ['Classic', 'Royal', 'Minimal', 'Elegant', 'Traditional'];

const FRAMES = [
    { category: 'Classic', name: 'Classic Double Rule', svg: classicDouble, layouts: ['portrait', 'landscape', 'square'] },
    { category: 'Classic', name: 'Classic Corner Keyline', svg: classicKeyline, layouts: ['portrait', 'square'] },

    { category: 'Royal', name: 'Royal Gold Crest', svg: royalCrest, layouts: ['portrait'] },
    { category: 'Royal', name: 'Royal Damask Band', svg: royalDamask, layouts: ['portrait', 'landscape', 'square'] },

    { category: 'Minimal', name: 'Minimal Hairline', svg: minimalHairline, layouts: ['portrait', 'landscape', 'square'] },
    // Corner ticks with no continuous border survive any aspect ratio.
    { category: 'Minimal', name: 'Minimal Corner Ticks', svg: minimalTicks, layouts: ['portrait', 'landscape', 'square'] },

    // An arch is drawn for a tall card; stretched to 16:9 it stops being an arch.
    { category: 'Elegant', name: 'Elegant Arch', svg: elegantArch, layouts: ['portrait'] },
    { category: 'Elegant', name: 'Elegant Script Rule', svg: elegantRule, layouts: ['portrait', 'square'] },

    { category: 'Traditional', name: 'Traditional Toran', svg: traditionalToran, layouts: ['portrait', 'square'] },
    { category: 'Traditional', name: 'Traditional Mandala Corners', svg: traditionalMandala, layouts: ['portrait', 'landscape', 'square'] },
];

/**
 * Pushes the SVG through the real media service, so it lands wherever the admin
 * panel's own uploads land. `upload` expects a multer-shaped object, which is
 * what this builds — going around it would let the seeder and the uploader drift.
 *
 * SVG is not in media.service's COMPRESSIBLE_MIMES, so the bytes pass through
 * untouched, which is what vector artwork needs.
 */
async function uploadSvg(name, svg) {
    const buffer = Buffer.from(svg, 'utf8');
    return mediaService.upload(
        {
            buffer,
            mimetype: 'image/svg+xml',
            size: buffer.length,
            originalname: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`,
        },
        { folder: 'frame-styles' },
        COMPANY_ID
    );
}

(async () => {
    if (PROD && !APPLY) {
        console.log('\n  DRY RUN — production. Re-run with --apply to write.\n');
    }

    console.log(`\n${TARGET}  ${process.env.DB_NAME}${FORCE ? '  *** --force: existing rows will be rewritten ***' : ''}\n`);

    const { TemplateCategory, FrameStyle, Setting } = db;

    const driver = await Setting.findOne({
        where: { group: 'media', key: 'driver', company_id: COMPANY_ID },
        attributes: ['value'],
    });
    console.log(`  storage driver: ${driver?.value ?? 'local (default)'}\n`);

    /* ── categories ──────────────────────────────────────────────────────── */

    console.log('  categories');
    const categoryByName = {};

    for (const name of CATEGORIES) {
        const existing = await TemplateCategory.findOne({
            where: { name, company_id: COMPANY_ID },
        });

        if (existing) {
            categoryByName[name] = existing;
            console.log(`    skip    ${name.padEnd(14)} #${existing.id}  (${existing.slug})`);
            continue;
        }

        if (PROD && !APPLY) {
            console.log(`    would   ${name}`);
            continue;
        }

        // Through the service, so the slug is derived and de-duplicated by the
        // same code the admin screen uses.
        const created = await categoryService.create({ name }, null, COMPANY_ID);
        categoryByName[name] = created;
        console.log(`    create  ${name.padEnd(14)} #${created.id}  (${created.slug})`);
    }

    if (PROD && !APPLY) {
        console.log('\n  dry run — nothing written.\n');
        process.exit(0);
    }

    /* ── frame styles ────────────────────────────────────────────────────── */

    console.log('\n  frame styles');
    let written = 0;
    let skipped = 0;
    let failed = 0;

    for (const [index, frame] of FRAMES.entries()) {
        const category = categoryByName[frame.category];
        if (!category) {
            console.log(`    FAIL    ${frame.name.padEnd(30)} no category "${frame.category}"`);
            failed += 1;
            continue;
        }

        const existing = await FrameStyle.findOne({
            where: { name: frame.name, company_id: COMPANY_ID },
        });

        if (existing && !FORCE) {
            skipped += 1;
            console.log(`    skip    ${frame.name.padEnd(30)} #${existing.id}`);
            continue;
        }

        let stored;
        try {
            stored = await uploadSvg(frame.name, frame.svg);
        } catch (error) {
            console.log(`    FAIL    ${frame.name.padEnd(30)} upload: ${error.message}`);
            failed += 1;
            continue;
        }

        const payload = {
            name: frame.name,
            template_category_id: category.id,
            file_url: stored.url,
            file_name: `${frame.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`,
            supported_layouts: frame.layouts,
            // Published AND active: a sample nothing can see demonstrates nothing.
            status: 'published',
            is_active: 1,
            sort_order: index,
            company_id: COMPANY_ID,
        };

        if (existing) {
            await existing.update(payload);
            console.log(`    update  ${frame.name.padEnd(30)} #${existing.id}`);
        } else {
            const row = await FrameStyle.create(payload);
            console.log(`    create  ${frame.name.padEnd(30)} #${row.id}`);
        }
        written += 1;
    }

    console.log(`\n  ${written} written · ${skipped} skipped · ${failed} failed\n`);

    const totalCategories = await TemplateCategory.count({ where: { company_id: COMPANY_ID } });
    const totalFrames = await FrameStyle.count({ where: { company_id: COMPANY_ID } });
    console.log(`  live now: ${totalCategories} categories · ${totalFrames} frame styles\n`);

    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
