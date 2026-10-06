/**
 * Artwork for `event-templates-classic.seeder.js` — SVG, 1080 x 1920.
 *
 * The pieces the four Classic templates are built from:
 *
 *   notchedFrame  — a double rule with bitten corners. Frame Style for the
 *                   Color template ("Ivory Letterpress").
 *   archFrame     — a double arch line. Frame Style for the Gradient template
 *                   ("Blush Morning").
 *   eucalyptus    — a finished background: two eucalyptus branches on warm
 *                   paper. The Image template's `background_image`.
 *   portraitBack  — tone-on-tone branches on dark olive. The Custom template's
 *                   stand-in picture until the host uploads their own.
 *   portraitFrame — a cream keyline that follows the Custom template's arch.
 *   laurelTop / laurelBottom — a small laurel crest for the head and foot of
 *                   the Color template (Decorations, placed `top` / `bottom`).
 *   wreath        — a ring of leaves drawn faintly behind the names on the
 *                   Gradient template (Decoration, placed `motif`).
 *   midnight      — a finished background: gold branches on midnight blue
 *                   inside a fine gold keyline. The dark Image template
 *                   ("Midnight Garden").
 *   steppedFrame  — a double rule with square-stepped corners, for the dark
 *                   Color template ("Emerald Gala").
 *   rule          — a short line-diamond-line, drawn as a row between two
 *                   sections (Decoration, placed `divider`).
 *
 * Line work and flat shapes only, in two or three colours each — what a
 * printed card is made of. The words are drawn over these inset about 11%
 * from the sides and 9% from the top and bottom (6% / 4% with no frame), so
 * everything here keeps to the edges and corners.
 */

const W = 1080;
const H = 1920;

const svg = (body, defs = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<defs>${defs}</defs>${body}</svg>`;

const n = (v) => Number(v.toFixed(1));

/* ─────────────────────────── notched double rule ─────────────────────────── */

/** A rectangle whose corners are bitten out by a quarter circle of radius `r`. */
const notched = (inset, r) => {
    const l = inset, t = inset, rt = W - inset, b = H - inset;
    return `M${l + r} ${t} H${rt - r} A${r} ${r} 0 0 0 ${rt} ${t + r} V${b - r} `
        + `A${r} ${r} 0 0 0 ${rt - r} ${b} H${l + r} A${r} ${r} 0 0 0 ${l} ${b - r} V${t + r} `
        + `A${r} ${r} 0 0 0 ${l + r} ${t} Z`;
};

const diamond = (cx, cy, s, color) =>
    `<path d="M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z" fill="${color}"/>`;

const notchedFrame = (color = '#B39355') => svg(
    `<g fill="none" stroke="${color}">`
    + `<path d="${notched(46, 54)}" stroke-width="6"/>`
    + `<path d="${notched(70, 54)}" stroke-width="2.5"/>`
    + `</g>`
    // One dot in each bitten corner, and a diamond between the rules at the
    // head and foot of the card.
    + [[58, 58], [W - 58, 58], [58, H - 58], [W - 58, H - 58]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${color}"/>`).join('')
    + diamond(W / 2, 58, 9, color) + diamond(W / 2, H - 58, 9, color)
);

/* ───────────────────────────────── arch line ─────────────────────────────── */

const arch = (inset, spring) => {
    const r = (W - inset * 2) / 2;
    return `M${inset} ${H - inset} V${spring} A${r} ${r} 0 0 1 ${W - inset} ${spring} V${H - inset} Z`;
};

const archFrame = (color = '#B9806F', spring = 600) => svg(
    `<g fill="none" stroke="${color}">`
    + `<path d="${arch(50, spring)}" stroke-width="6"/>`
    + `<path d="${arch(74, spring)}" stroke-width="2.5"/>`
    + `</g>`
    + diamond(W / 2, H - 62, 9, color)
);

/**
 * The Custom template masks the card to an arch whose curve starts half a
 * card-width down. Springing from the same line keeps this keyline parallel
 * to the card's own edge all the way round.
 */
const portraitFrame = () => archFrame('#F1E3C8', W / 2);

/* ───────────────────────────────── laurel ────────────────────────────────── */

/** A laurel sprig: a short curved stem with narrow leaves, tip last. */
const sprig = (from, bend, to, color, leaves = 7, size = 30) => {
    const at = (t) => {
        const u = 1 - t;
        return [
            u * u * from[0] + 2 * u * t * bend[0] + t * t * to[0],
            u * u * from[1] + 2 * u * t * bend[1] + t * t * to[1],
        ];
    };
    const tangent = (t) => {
        const dx = 2 * (1 - t) * (bend[0] - from[0]) + 2 * t * (to[0] - bend[0]);
        const dy = 2 * (1 - t) * (bend[1] - from[1]) + 2 * t * (to[1] - bend[1]);
        return (Math.atan2(dy, dx) * 180) / Math.PI;
    };
    let out = `<path d="M${from[0]} ${from[1]} Q${bend[0]} ${bend[1]} ${to[0]} ${to[1]}" fill="none" `
        + `stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
    for (let i = 0; i < leaves; i += 1) {
        const t = 0.12 + (i / leaves) * 0.86;
        const [x, y] = at(t);
        const len = size * (1 - 0.35 * t);
        const deg = tangent(t) + (i % 2 ? 34 : -34);
        out += `<ellipse cx="${n(len * 0.55)}" cy="0" rx="${n(len * 0.55)}" ry="${n(len * 0.2)}" fill="${color}" `
            + `transform="translate(${n(x)} ${n(y)}) rotate(${n(deg)})"/>`;
    }
    const [tx, ty] = at(1);
    out += `<ellipse cx="${n(size * 0.4)}" cy="0" rx="${n(size * 0.4)}" ry="${n(size * 0.15)}" fill="${color}" `
        + `transform="translate(${n(tx)} ${n(ty)}) rotate(${n(tangent(1))})"/>`;
    return out;
};

/**
 * A band the full width of the card and 210 tall. The crest sits in its lower
 * half, clear of the frame's rules above it: two sprigs opening outward from
 * a diamond.
 */
const BAND = 210;
const laurelBand = (color, flip) => {
    const crest = sprig([520, 168], [440, 172], [372, 118], color)
        + sprig([560, 168], [640, 172], [708, 118], color)
        + diamond(W / 2, 162, 10, color);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND}" viewBox="0 0 ${W} ${BAND}">`
        + (flip ? `<g transform="translate(0 ${BAND}) scale(1 -1)">${crest}</g>` : crest)
        + `</svg>`;
};

const laurelTop = (color = '#B39355') => laurelBand(color, false);
const laurelBottom = (color = '#B39355') => laurelBand(color, true);

/* ───────────────────────────────── wreath ────────────────────────────────── */

/**
 * A ring of leaves, open at the top, on an 800 square. Drawn behind the names
 * at a fifth of its strength, so the colour here is deeper than it will look.
 */
const wreath = (color = '#A8525F') => {
    const S = 800, c = S / 2, r = 300;
    let out = '';
    // Two arms rising from the foot of the ring to either side of the gap.
    for (const dir of [1, -1]) {
        const count = 17;
        for (let i = 0; i < count; i += 1) {
            const a = (90 + dir * (8 + i * 9.2)) * (Math.PI / 180);
            const x = c + Math.cos(a) * r;
            const y = c + Math.sin(a) * r;
            // Along the ring, leaning in and out by turns.
            const along = (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI - dir * 90;
            const lean = (i % 2 ? 32 : -32) * dir;
            const len = 62 - i * 1.4;
            out += `<ellipse cx="${n(len * 0.55)}" cy="0" rx="${n(len * 0.55)}" ry="${n(len * 0.21)}" fill="${color}" `
                + `transform="translate(${n(x)} ${n(y)}) rotate(${n(along + lean)})"/>`;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${out}</svg>`;
};

/* ──────────────────────────────── eucalyptus ─────────────────────────────── */

/**
 * One branch: a curved stem from `from` to `to` (bent toward `bend`), with
 * round leaves in alternating pairs that get smaller toward the tip.
 */
const branch = ({ from, bend, to, leaves, size, stem, tones, opacity = 1 }) => {
    const at = (t) => {
        const u = 1 - t;
        return [
            u * u * from[0] + 2 * u * t * bend[0] + t * t * to[0],
            u * u * from[1] + 2 * u * t * bend[1] + t * t * to[1],
        ];
    };
    const tangent = (t) => {
        const dx = 2 * (1 - t) * (bend[0] - from[0]) + 2 * t * (to[0] - bend[0]);
        const dy = 2 * (1 - t) * (bend[1] - from[1]) + 2 * t * (to[1] - bend[1]);
        return (Math.atan2(dy, dx) * 180) / Math.PI;
    };

    let out = `<path d="M${from[0]} ${from[1]} Q${bend[0]} ${bend[1]} ${to[0]} ${to[1]}" fill="none" `
        + `stroke="${stem}" stroke-width="5" stroke-linecap="round"/>`;

    for (let i = 0; i < leaves; i += 1) {
        const t = 0.08 + (i / leaves) * 0.9;
        const [x, y] = at(t);
        const r = size * (1 - 0.5 * t);
        const side = i % 2 ? 1 : -1;
        const deg = tangent(t) + side * (58 + (i % 3) * 6);
        const tone = tones[i % tones.length];
        // A short stalk, then a leaf a little wider than it is long.
        out += `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(deg)})">`
            + `<line x1="0" y1="0" x2="${n(r * 0.35)}" y2="0" stroke="${stem}" stroke-width="3" stroke-linecap="round"/>`
            + `<ellipse cx="${n(r * 1.2)}" cy="0" rx="${n(r * 0.92)}" ry="${n(r * 0.8)}" fill="${tone}"/>`
            + `<line x1="${n(r * 0.35)}" y1="0" x2="${n(r * 1.7)}" y2="0" stroke="${stem}" stroke-width="1.5" opacity="0.45"/>`
            + `</g>`;
    }
    // The tip leaf, in line with the stem.
    const [tx, ty] = at(1);
    out += `<ellipse cx="${n(size * 0.5)}" cy="0" rx="${n(size * 0.5)}" ry="${n(size * 0.4)}" fill="${tones[0]}" `
        + `transform="translate(${n(tx)} ${n(ty)}) rotate(${n(tangent(1))})"/>`;

    return `<g opacity="${opacity}">${out}</g>`;
};

/** The same drawing turned half a circle, for the opposite corner. */
const opposite = (piece) => `<g transform="rotate(180 ${W / 2} ${H / 2})">${piece}</g>`;

const cornerBranches = (stem, tones, opacity = 1) =>
    branch({ from: [1110, 250], bend: [860, 250], to: [640, 70], leaves: 9, size: 62, stem, tones, opacity })
    + branch({ from: [1110, 250], bend: [1010, 420], to: [1000, 660], leaves: 8, size: 58, stem, tones, opacity })
    + branch({ from: [1110, 250], bend: [930, 330], to: [800, 380], leaves: 6, size: 46, stem, tones, opacity });

const eucalyptus = () => {
    const tones = ['#9DB09A', '#B7C6B2', '#84997F'];
    const corner = cornerBranches('#6F8469', tones);
    return svg(
        `<rect width="${W}" height="${H}" fill="#FAF7F0"/>`
        + `<rect width="${W}" height="${H}" fill="url(#paper)"/>`
        + corner + opposite(corner),
        `<radialGradient id="paper" cx="0.5" cy="0.5" r="0.75">`
        + `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.9"/>`
        + `<stop offset="1" stop-color="#F1EADB" stop-opacity="0.9"/></radialGradient>`
    );
};

/* ───────────────────────────────── midnight ──────────────────────────────── */

/**
 * The keyline is part of the picture and sits UNDER the branches, so the
 * leaves cross it — a Frame Style is drawn over everything and would cut
 * across them instead.
 */
const midnight = () => {
    const tones = ['#D9B76E', '#B8934A', '#E8CF95'];
    const corner = cornerBranches('#C9A45C', tones, 0.96);
    // A few fixed points of light in the outer band; none behind the words.
    const stars = Array.from({ length: 34 }, (_, i) => {
        const x = 70 + ((i * 389) % 940);
        const y = 90 + ((i * 677) % 1740);
        const inMiddle = x > 190 && x < 890 && y > 330 && y < 1590;
        const r = 2 + (i % 3);
        return inMiddle ? '' : `<circle cx="${x}" cy="${y}" r="${r}" fill="#E8CF95" opacity="${0.25 + (i % 4) * 0.12}"/>`;
    }).join('');
    const line = (inset, width, opacity) =>
        `<rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" fill="none" `
        + `stroke="#C9A45C" stroke-width="${width}" opacity="${opacity}"/>`;
    return svg(
        `<rect width="${W}" height="${H}" fill="#0E1830"/>`
        + `<rect width="${W}" height="${H}" fill="url(#night)"/>`
        + line(42, 5, 1) + line(62, 2, 0.8)
        + stars + corner + opposite(corner),
        `<radialGradient id="night" cx="0.5" cy="0.45" r="0.75">`
        + `<stop offset="0" stop-color="#22345E" stop-opacity="0.85"/>`
        + `<stop offset="1" stop-color="#0A1226" stop-opacity="0.85"/></radialGradient>`
    );
};

/* ────────────────────────────── portrait stand-in ─────────────────────────── */

const portraitBack = () => {
    const tones = ['#4B5648', '#566252', '#414B3F'];
    const corner = cornerBranches('#5C6958', tones, 0.9);
    return svg(
        `<rect width="${W}" height="${H}" fill="#343B33"/>`
        + `<rect width="${W}" height="${H}" fill="url(#glow)"/>`
        + corner + opposite(corner),
        `<radialGradient id="glow" cx="0.5" cy="0.42" r="0.7">`
        + `<stop offset="0" stop-color="#55604F" stop-opacity="0.55"/>`
        + `<stop offset="1" stop-color="#262B25" stop-opacity="0.6"/></radialGradient>`
    );
};

/* ───────────────────────────── stepped double rule ───────────────────────── */

/** A rectangle whose corners step in by a square of side `t`. */
const stepped = (i, t) => {
    const r = W - i, b = H - i;
    return `M${i + t} ${i} H${r - t} V${i + t} H${r} V${b - t} H${r - t} V${b} H${i + t} V${b - t} H${i} V${i + t} H${i + t} Z`;
};

const steppedFrame = (color = '#E6C77A') => svg(
    `<g fill="none" stroke="${color}">`
    + `<path d="${stepped(44, 50)}" stroke-width="6"/>`
    + `<path d="${stepped(68, 50)}" stroke-width="2.5"/>`
    + `</g>`
    // A diamond in each stepped corner, and one on each long side between the rules.
    + [[66, 66], [W - 66, 66], [66, H - 66], [W - 66, H - 66]]
        .map(([x, y]) => diamond(x, y, 11, color)).join('')
    + diamond(56, H / 2, 8, color) + diamond(W - 56, H / 2, 8, color)
);

/* ─────────────────────────────────── rule ────────────────────────────────── */

/** 600 x 60: line, small diamond, large diamond, small diamond, line. */
const rule = (color = '#E6C77A') =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="60" viewBox="0 0 600 60">`
    + `<g stroke="${color}" stroke-width="3" stroke-linecap="round">`
    + `<line x1="40" y1="30" x2="228" y2="30"/><line x1="372" y1="30" x2="560" y2="30"/></g>`
    + `<circle cx="30" cy="30" r="5" fill="${color}"/><circle cx="570" cy="30" r="5" fill="${color}"/>`
    + diamond(254, 30, 9, color) + diamond(346, 30, 9, color)
    + `<path d="M300 8 L322 30 L300 52 L278 30 Z" fill="none" stroke="${color}" stroke-width="3"/>`
    + diamond(300, 30, 8, color)
    + `</svg>`;

/* ── frames matched to a palette (2026-10-06) ── */

/**
 * Four frames drawn FOR a palette, because the catalogue had nothing in these
 * colours and a frame keeps the colours it was drawn in:
 *
 *   mandalaFrame   gold on navy     — double rule, a quarter mandala fanning in
 *                                     from two opposite corners, a small
 *                                     rosette in the other two.
 *   scallopFrame   gold on ivory    — double rule with a scalloped edge inside.
 *   keyFrame       gold on a photo  — one fine rule with a linked square at
 *                                     every corner.
 *   bandFrame      maroon and gold  — a SOLID maroon band round the card, gold
 *                                     rules either side and gold diamonds
 *                                     along it; it mats a photograph.
 *
 * The words sit 11% in from the sides and 13% from the top and bottom, so
 * everything here stays outside that box except where it is at a corner.
 */

/** Rings of pointed petals round (cx, cy). `rings` is [[radius, count, petalLength]]. */
const petalRings = (cx, cy, rings, color, width = 3) => {
    const parts = rings.map(([radius, count, len]) =>
        Array.from({ length: count }, (_, i) => {
            const deg = (i * 360) / count;
            return `<path d="M0 ${-radius} Q${n(len * 0.36)} ${n(-radius - len * 0.5)} 0 ${-radius - len} `
                + `Q${n(-len * 0.36)} ${n(-radius - len * 0.5)} 0 ${-radius} Z" transform="rotate(${n(deg)})"/>`;
        }).join('') + `<circle r="${radius}"/>`
    ).join('');
    return `<g transform="translate(${cx} ${cy})" fill="none" stroke="${color}" stroke-width="${width}">${parts}</g>`;
};

const rectRule = (inset, color, width, opacity = 1) =>
    `<rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" fill="none" `
    + `stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;

const mandalaFrame = (color = '#D9B866') => {
    const I = 46;
    // A full mandala centred ON the corner of the rule, cut to the inside of
    // the rule — what is left is the quarter that fans into the card.
    const quarter = (cx, cy) => petalRings(cx, cy, [[96, 14, 58], [186, 20, 64], [286, 28, 60]], color, 3.5)
        + `<circle cx="${cx}" cy="${cy}" r="30" fill="${color}"/>`;
    const rosette = (cx, cy) => petalRings(cx, cy, [[20, 8, 24]], color, 3) + `<circle cx="${cx}" cy="${cy}" r="8" fill="${color}"/>`;
    return svg(
        `<g clip-path="url(#inside)">${quarter(W - I, I)}${quarter(I, H - I)}</g>`
        + rectRule(I, color, 6) + rectRule(I + 22, color, 2, 0.85)
        + rosette(I + 58, I + 58) + rosette(W - I - 58, H - I - 58),
        `<clipPath id="inside"><rect x="${I}" y="${I}" width="${W - I * 2}" height="${H - I * 2}"/></clipPath>`
    );
};

const scallopFrame = (color = '#C9A84C') => {
    const I = 44, J = 70;
    // Arcs bulging INTO the card along the inner rule, a whole number per side.
    const run = (length, target) => { const count = Math.round(length / target); return [count, length / count]; };
    const [nx, wx] = run(W - J * 2, 62);
    const [ny, wy] = run(H - J * 2, 62);
    const arcs = (count, step, dx, dy, sweep) =>
        Array.from({ length: count }, () => `a${n(step / 2)} ${n(step / 2)} 0 0 ${sweep} ${n(dx * step)} ${n(dy * step)}`).join(' ');
    const d = `M${J} ${J} ${arcs(nx, wx, 1, 0, 0)} ${arcs(ny, wy, 0, 1, 0)} ${arcs(nx, wx, -1, 0, 0)} ${arcs(ny, wy, 0, -1, 0)} Z`;
    return svg(
        rectRule(I, color, 6)
        + `<path d="${d}" fill="none" stroke="${color}" stroke-width="3"/>`
        + [[I, I], [W - I, I], [I, H - I], [W - I, H - I]].map(([x, y]) => diamond(x, y, 13, color)).join('')
    );
};

const keyFrame = (color = '#E3C376') => {
    const I = 52, K = 74;
    // A square hooked through each corner of the rule.
    const key = (x, y) =>
        `<rect x="${x - K / 2}" y="${y - K / 2}" width="${K}" height="${K}" fill="none" stroke="${color}" stroke-width="4"/>`
        + `<rect x="${x - K / 4}" y="${y - K / 4}" width="${K / 2}" height="${K / 2}" fill="none" stroke="${color}" stroke-width="2.5" transform="rotate(45 ${x} ${y})"/>`;
    return svg(
        rectRule(I, color, 4) + rectRule(I + 16, color, 1.5, 0.8)
        + key(I + 8, I + 8) + key(W - I - 8, I + 8) + key(I + 8, H - I - 8) + key(W - I - 8, H - I - 8)
        + diamond(W / 2, I, 10, color) + diamond(W / 2, H - I, 10, color)
    );
};

const bandFrame = (band = '#6B1420', gold = '#E0BC66') => {
    const B = 74;                       // band width
    const mid = B / 2;
    const along = (from, to, fixed, horizontal) => {
        const count = Math.round((to - from) / 64);
        const step = (to - from) / count;
        return Array.from({ length: count - 1 }, (_, i) => {
            const v = from + step * (i + 1);
            return horizontal ? diamond(n(v), fixed, 9, gold) : diamond(fixed, n(v), 9, gold);
        }).join('');
    };
    const corner = (x, y) => petalRings(x, y, [[11, 8, 14]], gold, 2.5) + `<circle cx="${x}" cy="${y}" r="5" fill="${gold}"/>`;
    return svg(
        `<path fill-rule="evenodd" fill="${band}" d="M0 0 H${W} V${H} H0 Z M${B} ${B} V${H - B} H${W - B} V${B} Z"/>`
        + rectRule(12, gold, 3) + rectRule(B, gold, 5) + rectRule(B + 16, gold, 2, 0.9)
        + along(B, W - B, mid, true) + along(B, W - B, H - mid, true)
        + along(B, H - B, mid, false) + along(B, H - B, W - mid, false)
        + corner(mid, mid) + corner(W - mid, mid) + corner(mid, H - mid) + corner(W - mid, H - mid)
    );
};

module.exports = {
    mandalaFrame, scallopFrame, keyFrame, bandFrame,
    steppedFrame, rule, midnight,
    notchedFrame, archFrame, portraitFrame, eucalyptus, portraitBack,
    laurelTop, laurelBottom, wreath, W, H,
};
