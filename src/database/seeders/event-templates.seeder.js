/**
 * Sample invitation templates, with real photography.
 *
 * WHY THIS LIVES HERE AND NOT IN scratch/
 * scratch/ is for one-off scripts that get thrown away. A seeder is neither:
 * it is re-run on every fresh install and on any environment that needs
 * demonstrable data, so it belongs beside the other seeders and stays in the
 * repo. The migrations that were deleted taught this the hard way.
 *
 * WHAT IT DOES
 *   1. resolves the real taxonomy by NAME, so it cannot invent ids
 *   2. downloads each photo from Unsplash
 *   3. pushes it through the SAME media service the admin panel uses, so the
 *      images end up in the configured S3 bucket rather than hotlinked
 *   4. writes a complete template — every step of the wizard, not just the
 *      required fields
 *
 * ── WHY THE IMAGES ARE RE-HOSTED RATHER THAN HOTLINKED ───────────────────────
 * A seeded row pointing at images.unsplash.com is a row that breaks the day
 * that URL changes, on a screen the client sees. Uploading through
 * `media.service` also means the sample data exercises exactly the path the
 * uploader does — if S3 is misconfigured, this fails loudly here rather than
 * silently later.
 *
 * ── background_type MUST AGREE WITH background_image ─────────────────────────
 * Every row below that carries a photo sets `background_type: 'image'`. The
 * first template created through the UI had an uploaded image and a type of
 * `color`, so the picture was stored, paid for, and never rendered. Seeded data
 * that repeats that bug teaches it.
 *
 *   node src/database/seeders/event-templates.seeder.js            (local)
 *   node src/database/seeders/event-templates.seeder.js --prod     (production)
 *   node src/database/seeders/event-templates.seeder.js --force    (rewrite existing)
 */
require('dotenv').config({
    path: process.argv.includes('--prod') ? '.env.production' : '.env',
});

const db = require('../../models');
const mediaService = require('../../services/media.service');

const FORCE = process.argv.includes('--force');
const TARGET = process.argv.includes('--prod') ? 'PRODUCTION' : 'LOCAL';
const COMPANY_ID = 1;

/**
 * Every id is verified reachable before use — one of the originally chosen
 * photos 404'd, and a seeder that silently writes a broken image URL is worse
 * than one that refuses to run.
 */
const PHOTO = (id, w = 1200) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&fm=jpg`;

/**
 * Taxonomy is resolved by NAME at runtime rather than hardcoded by id — ids
 * differ between local and production, and a seeder that assumes them writes
 * a wedding template onto the Corporate category.
 */
const TEMPLATES = [
    {
        name: 'Floral Wedding Classic',
        code: 'floral-wedding-classic',
        category: 'Wedding', type: 'Hindu Wedding', religion: 'Hindu',
        style: 'floral', layout_style: 'classic',
        description: 'Soft roses and gold detailing for a traditional Hindu ceremony.',
        tags: ['wedding', 'floral', 'traditional', 'gold'],
        photo: '1519741497674-611481863552',
        background_color: '#FFF7F0', secondary_color: '#8A6A3B',
        overlay_opacity: 30, border_style: 'ornate',
        primary_font: 'Playfair Display', secondary_font: 'Poppins',
        is_featured: 1, sort_order: 1,
    },
    {
        name: 'Royal Elegance',
        code: 'royal-elegance',
        category: 'Wedding', type: 'Hindu Wedding', religion: 'Hindu',
        style: 'royal', layout_style: 'elegant',
        description: 'Deep jewel tones and an ornate frame for a grand reception.',
        tags: ['wedding', 'royal', 'reception', 'luxury'],
        photo: '1511285560929-80b456fea0bc',
        background_color: '#2B1B3D', secondary_color: '#C9A227',
        overlay_opacity: 45, border_style: 'ornate',
        primary_font: 'Cinzel', secondary_font: 'Lora',
        is_featured: 1, sort_order: 2,
    },
    {
        name: 'Chapel Christian Wedding',
        code: 'chapel-christian-wedding',
        category: 'Wedding', type: 'Christian Wedding', religion: 'Christian',
        style: 'classic', layout_style: 'traditional',
        description: 'Understated and formal, built around a church ceremony.',
        tags: ['wedding', 'christian', 'church', 'formal'],
        photo: '1465495976277-4387d4b0b4c6',
        background_color: '#F7F5EF', secondary_color: '#6B7A8F',
        overlay_opacity: 25, border_style: 'arch',
        primary_font: 'Cormorant Garamond', secondary_font: 'Montserrat',
        sort_order: 3,
    },
    {
        name: 'Minimal Greenery',
        code: 'minimal-greenery',
        category: 'Wedding', type: 'Christian Wedding', religion: 'Christian',
        style: 'minimal', layout_style: 'minimal',
        description: 'Eucalyptus and plenty of white space, for an outdoor ceremony.',
        tags: ['wedding', 'minimal', 'greenery', 'outdoor'],
        photo: '1530103862676-de8c9debad1d',
        background_color: '#FBFDFA', secondary_color: '#4E6B52',
        overlay_opacity: 15, border_style: 'corners',
        primary_font: 'Marcellus', secondary_font: 'Inter',
        // Deliberately restrictive, so the client portal's permission gating has
        // something real to demonstrate rather than every template allowing all.
        permissionOverrides: { decoration_elements: 0, social_icons: 0 },
        sort_order: 4,
    },
    {
        name: 'Confetti Birthday',
        code: 'confetti-birthday',
        category: 'Birthday', type: 'Birthday Party', religion: null,
        style: 'modern', layout_style: 'modern',
        description: 'Bright and playful, for a birthday party of any age.',
        tags: ['birthday', 'party', 'colourful', 'fun'],
        photo: '1464366400600-7168b8af9bc3',
        background_color: '#FFF3E6', secondary_color: '#E14B6A',
        overlay_opacity: 20, border_style: 'none',
        primary_font: 'Poppins', secondary_font: 'Inter',
        // A birthday invitation has no organiser or QR the way a managed event
        // does, so those are off — a template whose every switch is on is not a
        // template, it is a default.
        componentOverrides: { organizer: 0, social_icons: 0 },
        is_featured: 1, sort_order: 5,
    },
    {
        name: 'Golden Anniversary',
        code: 'golden-anniversary',
        category: 'Anniversary', type: 'Anniversary', religion: null,
        style: 'traditional', layout_style: 'elegant',
        description: 'Warm gold and script for a milestone anniversary.',
        tags: ['anniversary', 'gold', 'milestone'],
        photo: '1522673607200-164d1b6ce486',
        background_color: '#FFFBF0', secondary_color: '#B8860B',
        overlay_opacity: 25, border_style: 'floral-top',
        primary_font: 'Great Vibes', secondary_font: 'Lora',
        sort_order: 6,
    },
    {
        name: 'Corporate Conference',
        code: 'corporate-conference',
        category: 'Corporate', type: 'Conference', religion: 'Secular',
        style: 'modern', layout_style: 'minimal',
        description: 'Clean and professional, for conferences and summits.',
        tags: ['corporate', 'conference', 'professional'],
        photo: '1540575467063-178a50c2df87',
        photoFallback: '1533050487297-09b450131914',
        background_color: '#0F1E3D', secondary_color: '#3B82F6',
        overlay_opacity: 55, border_style: 'none',
        primary_font: 'Montserrat', secondary_font: 'Inter',
        // A conference badge is not a wedding invitation: no couple, no
        // religious decoration, and the QR is the entire point.
        componentOverrides: { host_names: 0, decoration_elements: 0, event_photos: 0 },
        permissionOverrides: { colors: 0, fonts: 0, decoration_elements: 0 },
        sort_order: 7,
    },
    {
        name: 'Executive Seminar',
        code: 'executive-seminar',
        category: 'Corporate', type: 'Seminar', religion: 'Secular',
        style: 'minimal', layout_style: 'modern',
        description: 'A restrained one-page layout for seminars and workshops.',
        tags: ['corporate', 'seminar', 'workshop'],
        photo: '1519225421980-715cb0215aed',
        background_color: '#F4F6F8', secondary_color: '#1F2937',
        overlay_opacity: 10, border_style: 'corners',
        primary_font: 'Inter', secondary_font: 'Inter',
        componentOverrides: { host_names: 0, decoration_elements: 0, social_icons: 0 },
        sort_order: 8,
    },
    {
        name: 'Sangeet Night',
        code: 'sangeet-night',
        category: 'Wedding', type: 'Hindu Wedding', religion: 'Hindu',
        style: 'royal', layout_style: 'traditional',
        description: 'Vivid colour and mandala work for the sangeet.',
        tags: ['wedding', 'sangeet', 'music', 'colourful'],
        photo: '1478146896981-b80fe463b330',
        background_color: '#3B0A45', secondary_color: '#F5A623',
        overlay_opacity: 40, border_style: 'ornate',
        primary_font: 'Cinzel', secondary_font: 'Poppins',
        sort_order: 9,
    },
    {
        name: 'Garden Reception',
        code: 'garden-reception',
        category: 'Wedding', type: 'Christian Wedding', religion: 'Christian',
        style: 'floral', layout_style: 'classic',
        description: 'Daylight, foliage and script, for a garden reception.',
        tags: ['wedding', 'garden', 'reception', 'outdoor'],
        photo: '1513151233558-d860c5398176',
        background_color: '#F6FBF4', secondary_color: '#5B8C5A',
        overlay_opacity: 20, border_style: 'arch',
        primary_font: 'Dancing Script', secondary_font: 'Montserrat',
        sort_order: 10,
    },
];

const COMPONENT_KEYS = [
    'event_title', 'host_names', 'date_time', 'venue', 'event_qr_code', 'organizer',
    'event_photos', 'contact_details', 'invitation_message', 'social_icons',
    'footer_note', 'decoration_elements',
];
const PERMISSION_KEYS = ['background', 'colors', 'fonts', ...COMPONENT_KEYS];

const allOn = (keys, overrides = {}) =>
    keys.reduce((acc, k) => ({ ...acc, [k]: k in overrides ? overrides[k] : 1 }), {});

/** Fetch once, with the URL verified before anything is written. */
async function fetchImage(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error(`not an image (${type})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1024) throw new Error(`suspiciously small (${buffer.length}b)`);
    return { buffer, mimetype: type.split(';')[0] };
}

/**
 * Pushes the downloaded bytes through the real media service, so the file lands
 * wherever the admin panel's own uploads land — S3 here.
 *
 * `media.service.upload` expects a multer-shaped object, which is exactly what
 * this builds. Going around it and writing to S3 directly would mean the seeder
 * and the uploader could drift apart.
 */
async function uploadToStorage(name, { buffer, mimetype }) {
    const ext = mimetype === 'image/png' ? 'png' : 'jpg';
    return mediaService.upload(
        {
            buffer,
            mimetype,
            size: buffer.length,
            originalname: `${name}.${ext}`,
        },
        { folder: 'templates' },
        COMPANY_ID
    );
}

(async () => {
    console.log(`\n${TARGET}  ${process.env.DB_NAME}${FORCE ? '  *** --force: existing rows will be rewritten ***' : ''}\n`);

    const { EventTemplate, EventCategory, EventType, Religion, Setting } = db;

    const driver = await Setting.findOne({
        where: { group: 'media', key: 'driver', company_id: COMPANY_ID },
        attributes: ['value'],
    });
    console.log(`  storage driver: ${driver?.value ?? 'local (default)'}\n`);

    const [cats, types, religions] = await Promise.all([
        EventCategory.findAll({ attributes: ['id', 'name'], raw: true }),
        EventType.findAll({ attributes: ['id', 'name', 'event_category_id'], raw: true }),
        Religion.findAll({ attributes: ['id', 'name', 'event_category_id', 'event_type_id'], raw: true }),
    ]);

    const findCat = (name) => cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const findType = (name, catId) =>
        types.find((t) => t.name.toLowerCase() === name.toLowerCase() && t.event_category_id === catId);
    // Religion is scoped to (category, type), so the lookup has to match all
    // three or the API's own validation would reject the row this writes.
    const findReligion = (name, catId, typeId) =>
        religions.find(
            (r) => r.name.toLowerCase() === name.toLowerCase()
                && r.event_category_id === catId
                && r.event_type_id === typeId
        );

    let created = 0, skipped = 0, failed = 0;

    for (const t of TEMPLATES) {
        const existing = await EventTemplate.findOne({ where: { code: t.code, company_id: COMPANY_ID } });
        if (existing && !FORCE) {
            console.log(`  skip    ${t.code.padEnd(28)} already present`);
            skipped += 1;
            continue;
        }

        const cat = findCat(t.category);
        if (!cat) { console.log(`  FAIL    ${t.code.padEnd(28)} no category "${t.category}"`); failed += 1; continue; }

        const type = findType(t.type, cat.id);
        if (!type) { console.log(`  FAIL    ${t.code.padEnd(28)} no type "${t.type}" under ${t.category}`); failed += 1; continue; }

        const religion = t.religion ? findReligion(t.religion, cat.id, type.id) : null;
        if (t.religion && !religion) {
            // Not fatal: religion is optional on a template, and writing the row
            // without it beats refusing to seed at all.
            console.log(`  note    ${t.code.padEnd(28)} no religion "${t.religion}" in this scope — left blank`);
        }

        // Download, then upload. Falls back to a second photo id if the first
        // has gone away, and only then gives up on the row.
        let stored;
        for (const id of [t.photo, t.photoFallback].filter(Boolean)) {
            try {
                const img = await fetchImage(PHOTO(id));
                stored = await uploadToStorage(t.code, img);
                console.log(`  image   ${t.code.padEnd(28)} ${(img.buffer.length / 1024).toFixed(0)}kb -> ${stored.driver}`);
                break;
            } catch (e) {
                console.log(`  retry   ${t.code.padEnd(28)} photo ${id}: ${e.message}`);
            }
        }
        if (!stored) { console.log(`  FAIL    ${t.code.padEnd(28)} no usable image`); failed += 1; continue; }

        const payload = {
            company_id: COMPANY_ID,
            name: t.name,
            code: t.code,
            event_category_id: cat.id,
            event_type_id: type.id,
            religion_id: religion?.id ?? null,
            style: t.style,
            tags: t.tags,
            description: t.description,

            layout_style: t.layout_style,
            // Set together, always. See the header note.
            background_type: 'image',
            background_image: stored.url,
            background_color: t.background_color,
            secondary_color: t.secondary_color,
            gradient_from: t.background_color,
            gradient_to: t.secondary_color,
            overlay_opacity: t.overlay_opacity,
            orientation: 'portrait',
            dimension: '1080x1920',
            primary_font: t.primary_font,
            secondary_font: t.secondary_font,
            border_style: t.border_style,

            components: allOn(COMPONENT_KEYS, t.componentOverrides),
            component_order: [...COMPONENT_KEYS],
            permissions: allOn(PERMISSION_KEYS, t.permissionOverrides),

            // Published AND active: a sample template that a client cannot see
            // demonstrates nothing.
            status: 'published',
            is_active: 1,
            is_featured: t.is_featured ?? 0,
            available_for: ['individual', 'company'],
            plan_availability: 'all',
            plan_ids: [],
            sort_order: t.sort_order,
            show_on_homepage: t.is_featured ? 1 : 0,
            // The same image doubles as the gallery card. A separate 600x400
            // crop would be better, and there is no cropper in this path.
            thumbnail: stored.url,
        };

        if (existing) {
            await existing.update(payload);
            console.log(`  update  ${t.code.padEnd(28)} #${existing.id}`);
        } else {
            const row = await EventTemplate.create(payload);
            console.log(`  create  ${t.code.padEnd(28)} #${row.id}`);
        }
        created += 1;
    }

    console.log(`\n  ${created} written · ${skipped} skipped · ${failed} failed\n`);

    const total = await EventTemplate.count({ where: { company_id: COMPANY_ID } });
    console.log(`  live templates now: ${total}\n`);

    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
