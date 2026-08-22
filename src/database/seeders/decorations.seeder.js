/**
 * Sample data for the Decorations module.
 *
 *      node src/database/seeders/decorations.seeder.js
 *      node src/database/seeders/decorations.seeder.js --force
 *      node src/database/seeders/decorations.seeder.js --prod --apply
 *
 * Eleven decorations covering every `type` the module offers, uploaded through
 * the real media service.
 *
 * ── WHY THE ARTWORK IS GENERATED, NOT DOWNLOADED ─────────────────────────────
 * Same reason as `frame-styles.seeder.js`. A decoration is laid OVER an
 * invitation, so everything that is not the ornament has to be transparent.
 * Stock photography is an opaque rectangle: dropped into a corner slot it hides
 * the invitation instead of decorating it, and the module's own Tips box warns
 * about exactly that. So each one is a real SVG with a transparent ground.
 *
 * ── EACH TYPE GETS ITS OWN CANVAS SHAPE ──────────────────────────────────────
 * A corner is square, a divider is a wide strip, a top is a wide band. Drawing
 * them all on one canvas would make the previews lie about the proportions the
 * artwork is actually used at.
 *
 * Idempotent — existing rows are skipped by name, `--force` rewrites them.
 */

require('dotenv').config({
    path: process.argv.includes('--prod') ? '.env.production' : '.env',
});

const db = require('../../models');
const mediaService = require('../../services/media.service');

const FORCE = process.argv.includes('--force');
const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const TARGET = PROD ? 'PRODUCTION' : 'LOCAL';
const COMPANY_ID = 1;

/* ------------------------------------------------------------- primitives -- */

const svg = (w, h, body, defs = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    // No background rect at all — a transparent ground is the whole point.
    `${body}</svg>`;

/**
 * A flower: petals as rotated ellipses around a centre, plus a seed disc.
 *
 * Drawn from primitives rather than hand-plotted paths so the same routine can
 * produce a rose, a marigold and a daisy by changing three numbers — which is
 * what keeps eleven decorations from being eleven unrelated blobs.
 */
const flower = (cx, cy, r, petals, fill, core, rot = 0) => {
    const arms = Array.from({ length: petals }, (_, i) => {
        const a = rot + (i * 360) / petals;
        return `<ellipse cx="${cx}" cy="${cy - r * 0.55}" rx="${r * 0.3}" ry="${r * 0.55}"
                         fill="${fill}" transform="rotate(${a} ${cx} ${cy})"/>`;
    }).join('');
    return `${arms}<circle cx="${cx}" cy="${cy}" r="${r * 0.26}" fill="${core}"/>`;
};

/** A leaf: two mirrored quadratics meeting at a tip, with a midrib. */
const leaf = (x, y, len, wide, fill, angle = 0) =>
    `<g transform="rotate(${angle} ${x} ${y})">
       <path d="M${x} ${y} Q${x + wide} ${y - len * 0.45} ${x} ${y - len}
                Q${x - wide} ${y - len * 0.45} ${x} ${y} Z" fill="${fill}"/>
       <path d="M${x} ${y} L${x} ${y - len}" stroke="rgba(0,0,0,0.16)" stroke-width="1" fill="none"/>
     </g>`;

const PINK = '#E4738F';
const PINK_D = '#C6415F';
const YELLOW = '#F2C14E';
const GREEN = '#6B9E5E';
const GREEN_D = '#4A7A42';
const GOLD = '#C9A227';
const GOLD_D = '#A8801A';
const PURPLE = '#9B72CF';
const ROSE = '#B23A48';

/* ------------------------------------------------------------ the artwork -- */

/** Corner — pink roses trailing down and across from the top-left. */
const pinkFloralCorner = svg(320, 320, `
  <path d="M18 150 Q40 90 100 62 Q160 34 250 26" fill="none" stroke="${GREEN_D}" stroke-width="3"/>
  <path d="M26 210 Q34 140 74 96" fill="none" stroke="${GREEN_D}" stroke-width="2.5"/>
  ${leaf(60, 96, 40, 15, GREEN, -35)}
  ${leaf(120, 66, 36, 14, GREEN, 25)}
  ${leaf(196, 40, 34, 13, GREEN_D, -20)}
  ${leaf(30, 176, 38, 14, GREEN, 15)}
  ${leaf(96, 74, 30, 12, GREEN_D, 70)}
  ${flower(56, 62, 34, 6, PINK, YELLOW)}
  ${flower(126, 40, 26, 6, PINK_D, YELLOW, 18)}
  ${flower(30, 122, 24, 6, PINK_D, YELLOW, 30)}
  ${flower(196, 30, 20, 5, PINK, YELLOW, 10)}
  ${flower(22, 196, 17, 5, PINK, YELLOW, 45)}
  <circle cx="160" cy="58" r="5" fill="${PINK_D}"/>
  <circle cx="238" cy="34" r="4" fill="${PINK}"/>
  <circle cx="44" cy="236" r="4" fill="${PINK_D}"/>
`);

/**
 * Corner — eucalyptus sprigs fanning out FROM the corner.
 *
 * The first version ran one stem diagonally across the middle of the canvas, so
 * it read as a floating branch rather than as a corner piece — dropped into a
 * corner slot it would have pointed at nothing. Three stems now radiate from a
 * single anchor at the top-left: one along the top, one down the side, one
 * through the diagonal.
 */
const greenLeavesCorner = svg(320, 320, `
  <g transform="translate(26 26)">
    <path d="M0 0 Q90 6 168 34 Q224 54 262 92" fill="none" stroke="${GREEN_D}" stroke-width="3"/>
    <path d="M0 0 Q6 90 34 168 Q54 224 92 262" fill="none" stroke="${GREEN_D}" stroke-width="3"/>
    <path d="M0 0 Q76 76 150 150" fill="none" stroke="${GREEN_D}" stroke-width="2.2"/>

    ${[[46, 16], [92, 28], [136, 46], [176, 70], [210, 98]]
        .map(([x, y], i) => leaf(x, y, 44 - i * 3, 16 - i, i % 2 ? GREEN : GREEN_D, 118 + i * 6)
            + leaf(x, y, 40 - i * 3, 14 - i, i % 2 ? GREEN_D : GREEN, 34 + i * 6)).join('')}

    ${[[16, 46], [28, 92], [46, 136], [70, 176], [98, 210]]
        .map(([x, y], i) => leaf(x, y, 44 - i * 3, 16 - i, i % 2 ? GREEN : GREEN_D, -28 - i * 6)
            + leaf(x, y, 40 - i * 3, 14 - i, i % 2 ? GREEN_D : GREEN, 56 + i * 6)).join('')}

    ${[[52, 52], [92, 92], [128, 128]]
        .map(([x, y], i) => leaf(x, y, 34 - i * 4, 13 - i, GREEN, 75)
            + leaf(x, y, 30 - i * 4, 12 - i, GREEN_D, 5)).join('')}

    <circle cx="0" cy="0" r="6" fill="${GREEN_D}"/>
  </g>
`);

/** Divider — gold flourish with a centre lozenge. */
const goldenDivider = svg(600, 90, `
  <path d="M40 45 Q150 45 250 45" stroke="${GOLD}" stroke-width="2.5" fill="none"/>
  <path d="M350 45 Q450 45 560 45" stroke="${GOLD}" stroke-width="2.5" fill="none"/>
  <path d="M250 45 Q276 20 300 45 Q324 70 350 45" fill="none" stroke="${GOLD_D}" stroke-width="3"/>
  <path d="M250 45 Q276 70 300 45 Q324 20 350 45" fill="none" stroke="${GOLD_D}" stroke-width="3"/>
  <path d="M300 30 L312 45 L300 60 L288 45 Z" fill="${GOLD}"/>
  <circle cx="250" cy="45" r="5" fill="${GOLD_D}"/>
  <circle cx="350" cy="45" r="5" fill="${GOLD_D}"/>
  <path d="M40 45 Q26 32 12 45 Q26 58 40 45 Z" fill="${GOLD}"/>
  <path d="M560 45 Q574 32 588 45 Q574 58 560 45 Z" fill="${GOLD}"/>
  <circle cx="150" cy="45" r="3.5" fill="${GOLD}"/>
  <circle cx="450" cy="45" r="3.5" fill="${GOLD}"/>
`);

/** Divider — a leafy sprig either side of a small bloom. */
const leafDivider = svg(600, 90, `
  <path d="M60 45 L262 45" stroke="${GREEN_D}" stroke-width="2" fill="none"/>
  <path d="M338 45 L540 45" stroke="${GREEN_D}" stroke-width="2" fill="none"/>
  ${[100, 150, 200].flatMap((x) => [leaf(x, 45, 26, 10, GREEN, 35), leaf(x, 45, 26, 10, GREEN_D, 145)]).join('')}
  ${[400, 450, 500].flatMap((x) => [leaf(x, 45, 26, 10, GREEN_D, 35), leaf(x, 45, 26, 10, GREEN, 145)]).join('')}
  ${flower(300, 45, 26, 6, PINK, YELLOW)}
  <circle cx="60" cy="45" r="4" fill="${GREEN_D}"/>
  <circle cx="540" cy="45" r="4" fill="${GREEN_D}"/>
`);

/** Ornament — a draped chain with three pendants. */
const hangingOrnament = svg(400, 240, `
  <path d="M20 16 Q200 132 380 16" fill="none" stroke="${GOLD_D}" stroke-width="3"/>
  ${[[110, 74], [200, 96], [290, 74]].map(([x, y], i) => `
    <line x1="${x}" y1="${y}" x2="${x}" y2="${y + 34 + i * 6}" stroke="${GOLD_D}" stroke-width="2"/>
    <path d="M${x} ${y + 34 + i * 6} q-16 22 0 44 q16 -22 0 -44 Z" fill="${GOLD}"/>
    <circle cx="${x}" cy="${y + 88 + i * 6}" r="6" fill="${ROSE}"/>`).join('')}
  <circle cx="20" cy="16" r="7" fill="${GOLD_D}"/>
  <circle cx="380" cy="16" r="7" fill="${GOLD_D}"/>
  ${flower(200, 62, 22, 6, ROSE, YELLOW)}
`);

/** Ornament — hanging bell cluster. */
const bellOrnament = svg(400, 240, `
  <path d="M30 20 Q200 96 370 20" fill="none" stroke="${ROSE}" stroke-width="3"/>
  ${[[120, 60], [200, 78], [280, 60]].map(([x, y]) => `
    <line x1="${x}" y1="${y}" x2="${x}" y2="${y + 26}" stroke="${ROSE}" stroke-width="2"/>
    <path d="M${x - 26} ${y + 88} q0 -50 26 -62 q26 12 26 62 Z" fill="${GOLD}"/>
    <ellipse cx="${x}" cy="${y + 88}" rx="30" ry="6" fill="${GOLD_D}"/>
    <circle cx="${x}" cy="${y + 100}" r="6" fill="${GOLD_D}"/>`).join('')}
`);

/**
 * Top — soft watercolour wash.
 *
 * A blur filter over overlapping blobs; flat shapes would give hard edges and
 * stop reading as watercolour, which is the one thing the name promises.
 *
 * The blobs deliberately overrun the canvas on BOTH sides so the band bleeds
 * off the edges. The first version only overran the left, which read as a
 * clipped shape rather than a continuous wash. `stdDeviation` differs per layer
 * so the edges are not all equally soft — a single blur radius everywhere is
 * what makes a wash look like a blurred rectangle.
 */
const purpleWatercolorTop = svg(600, 160, `
  <g filter="url(#washSoft)" opacity="0.55">
    <ellipse cx="-20" cy="46" rx="180" ry="52" fill="#B79BE0"/>
    <ellipse cx="300" cy="34" rx="260" ry="46" fill="${PURPLE}"/>
    <ellipse cx="620" cy="46" rx="180" ry="52" fill="#B79BE0"/>
  </g>
  <g filter="url(#washMid)" opacity="0.6">
    <ellipse cx="120" cy="62" rx="150" ry="42" fill="${PURPLE}"/>
    <ellipse cx="330" cy="72" rx="170" ry="38" fill="#8A5FC0"/>
    <ellipse cx="540" cy="60" rx="140" ry="40" fill="${PURPLE}"/>
  </g>
  <g filter="url(#washTight)" opacity="0.5">
    <ellipse cx="210" cy="96" rx="110" ry="24" fill="#7A4FB0"/>
    <ellipse cx="450" cy="100" rx="120" ry="22" fill="#8A5FC0"/>
    <ellipse cx="60" cy="88" rx="80" ry="20" fill="${PURPLE}"/>
  </g>
  ${/* A few harder specks: pigment pooling at the edge of a wash is what stops
        it looking like a gradient. */
    [[96, 108, 5], [188, 118, 4], [286, 112, 6], [372, 122, 4], [462, 114, 5], [548, 106, 4]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#7A4FB0" opacity="0.28"/>`).join('')}
`, `<filter id="washSoft" x="-30%" y="-80%" width="160%" height="280%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>
    <filter id="washMid" x="-30%" y="-80%" width="160%" height="280%">
      <feGaussianBlur stdDeviation="13"/>
    </filter>
    <filter id="washTight" x="-30%" y="-80%" width="160%" height="280%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>`);

/** Top — marigold toran garland. */
const marigoldToranTop = svg(600, 160, `
  <path d="M10 16 L590 16" stroke="${GREEN_D}" stroke-width="4"/>
  ${Array.from({ length: 12 }, (_, i) => 34 + i * 48).map((x, i) => {
        const drop = 40 + (i % 3) * 22;
        return `<line x1="${x}" y1="16" x2="${x}" y2="${drop}" stroke="${GREEN_D}" stroke-width="2"/>
                ${flower(x, drop + 16, 18, 8, i % 2 ? YELLOW : '#E88A2A', '#C96A12')}
                <line x1="${x}" y1="${drop + 32}" x2="${x}" y2="${drop + 50}" stroke="${GREEN_D}" stroke-width="1.5"/>
                ${leaf(x, drop + 66, 20, 8, GREEN, 0)}`;
    }).join('')}
`);

/** Bottom — mirrored gold scrollwork. */
const goldScrollBottom = svg(600, 120, `
  <path d="M20 96 Q150 96 210 62 Q262 32 300 62 Q338 92 390 62 Q450 28 580 96"
        fill="none" stroke="${GOLD}" stroke-width="3"/>
  <path d="M60 104 Q170 104 224 76 Q266 54 300 76 Q334 98 376 76 Q430 48 540 104"
        fill="none" stroke="${GOLD_D}" stroke-width="1.6" opacity="0.75"/>
  <path d="M300 46 l12 16 l-12 16 l-12 -16 Z" fill="${GOLD}"/>
  <circle cx="210" cy="62" r="5" fill="${GOLD_D}"/>
  <circle cx="390" cy="62" r="5" fill="${GOLD_D}"/>
  <circle cx="20" cy="96" r="6" fill="${GOLD}"/>
  <circle cx="580" cy="96" r="6" fill="${GOLD}"/>
`);

/** Motif — paisley. */
const paisleyMotif = svg(220, 220, `
  <path d="M110 24 Q186 54 176 122 Q168 182 116 190 Q66 196 62 156
           Q60 124 92 118 Q120 114 124 140"
        fill="none" stroke="${ROSE}" stroke-width="6" stroke-linecap="round"/>
  <path d="M110 46 Q168 70 160 122 Q154 168 116 174 Q84 178 82 152"
        fill="none" stroke="${GOLD}" stroke-width="3"/>
  ${[[128, 82], [146, 112], [138, 148], [110, 160]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${GOLD}"/>`).join('')}
  ${flower(110, 30, 16, 6, ROSE, YELLOW)}
`);

/** Motif — concentric mandala. */
const mandalaMotif = svg(220, 220, `
  <circle cx="110" cy="110" r="86" fill="none" stroke="${GOLD}" stroke-width="3"/>
  <circle cx="110" cy="110" r="62" fill="none" stroke="${ROSE}" stroke-width="2"/>
  <circle cx="110" cy="110" r="34" fill="none" stroke="${GOLD}" stroke-width="2"/>
  ${Array.from({ length: 16 }, (_, i) => {
        const a = (i * Math.PI * 2) / 16;
        const c = Math.cos(a);
        const s = Math.sin(a);
        return `<line x1="${110 + 34 * c}" y1="${110 + 34 * s}"
                      x2="${110 + 62 * c}" y2="${110 + 62 * s}" stroke="${GOLD}" stroke-width="2"/>
                <circle cx="${110 + 74 * c}" cy="${110 + 74 * s}" r="5" fill="${ROSE}"/>`;
    }).join('')}
  ${flower(110, 110, 26, 8, GOLD, ROSE)}
`);

/* -------------------------------------------------------------- the sample -- */

const DECORATIONS = [
    { name: 'Pink Floral Corner', type: 'corner', svg: pinkFloralCorner },
    { name: 'Green Leaves Corner', type: 'corner', svg: greenLeavesCorner },
    { name: 'Golden Divider', type: 'divider', svg: goldenDivider },
    { name: 'Leaf Sprig Divider', type: 'divider', svg: leafDivider },
    { name: 'Hanging Ornament', type: 'ornament', svg: hangingOrnament },
    { name: 'Bell Cluster Ornament', type: 'ornament', svg: bellOrnament },
    { name: 'Purple Watercolor Top', type: 'top', svg: purpleWatercolorTop },
    { name: 'Marigold Toran Top', type: 'top', svg: marigoldToranTop },
    { name: 'Gold Scroll Bottom', type: 'bottom', svg: goldScrollBottom },
    { name: 'Paisley Motif', type: 'motif', svg: paisleyMotif },
    { name: 'Mandala Motif', type: 'motif', svg: mandalaMotif },
];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * Through the real media service, so the file lands wherever the admin panel's
 * own uploads land. SVG is not in COMPRESSIBLE_MIMES, so the bytes pass through
 * untouched — which is what vector artwork needs.
 */
async function uploadSvg(name, body) {
    const buffer = Buffer.from(body, 'utf8');
    const stored = await mediaService.upload(
        {
            buffer,
            mimetype: 'image/svg+xml',
            size: buffer.length,
            originalname: `${slug(name)}.svg`,
        },
        { folder: 'decorations' },
        COMPANY_ID
    );
    // The size that goes on the row is what the service REPORTS it stored, not
    // the buffer length — those differ the day compression is turned on.
    return { url: stored.url, size: stored.size ?? buffer.length };
}

(async () => {
    if (PROD && !APPLY) {
        console.log('\n  DRY RUN — production. Re-run with --apply to write.\n');
    }

    console.log(`\n${TARGET}  ${process.env.DB_NAME}${FORCE ? '  *** --force: existing rows will be rewritten ***' : ''}\n`);

    const { Decoration, Setting } = db;

    const driver = await Setting.findOne({
        where: { group: 'media', key: 'driver', company_id: COMPANY_ID },
        attributes: ['value'],
    });
    console.log(`  storage driver: ${driver?.value ?? 'local (default)'}\n`);

    let written = 0;
    let skipped = 0;
    let failed = 0;

    for (const [index, item] of DECORATIONS.entries()) {
        const existing = await Decoration.findOne({
            where: { name: item.name, company_id: COMPANY_ID },
        });

        if (existing && !FORCE) {
            skipped += 1;
            console.log(`  skip    ${item.name.padEnd(26)} #${existing.id}`);
            continue;
        }

        if (PROD && !APPLY) {
            console.log(`  would   ${item.name}`);
            continue;
        }

        let stored;
        try {
            stored = await uploadSvg(item.name, item.svg);
        } catch (error) {
            console.log(`  FAIL    ${item.name.padEnd(26)} upload: ${error.message}`);
            failed += 1;
            continue;
        }

        const payload = {
            name: item.name,
            type: item.type,
            file_url: stored.url,
            file_name: `${slug(item.name)}.svg`,
            file_format: 'SVG',
            file_size: stored.size,
            // Active: a sample nothing can see demonstrates nothing.
            is_active: 1,
            sort_order: index,
            company_id: COMPANY_ID,
        };

        if (existing) {
            await existing.update(payload);
            console.log(`  update  ${item.name.padEnd(26)} #${existing.id}  ${item.type}`);
        } else {
            const row = await Decoration.create(payload);
            console.log(`  create  ${item.name.padEnd(26)} #${row.id}  ${item.type}`);
        }
        written += 1;
    }

    if (PROD && !APPLY) {
        console.log('\n  dry run — nothing written.\n');
        process.exit(0);
    }

    console.log(`\n  ${written} written · ${skipped} skipped · ${failed} failed\n`);

    const total = await Decoration.count({ where: { company_id: COMPANY_ID } });
    console.log(`  live decorations now: ${total}\n`);

    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
