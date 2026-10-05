/**
 * Artwork for `event-templates-sample.seeder.js` — generated SVG, 1080 x 1920.
 *
 * Three pieces per template category, each in that category's own palette:
 *
 *   frame   — a border with ornaments and a TRANSPARENT middle. Becomes a
 *             Frame Style row; drawn over the Color and Gradient templates.
 *   image   — a finished background with its own border. The Image template's
 *             `background_image`; it needs no frame on top.
 *   custom  — an all-over pattern with no border. The Custom template's
 *             design, which the card masks to an arch.
 *
 * ── THE MIDDLE STAYS QUIET ────────────────────────────────────────�
 * The invitation's words are drawn over these, inset about 11% from the sides
 * and 9% from the top and bottom. Everything ornamental therefore lives in the
 * outer band and the corners; what crosses the middle is faint enough to read
 * text over. A background that looks rich on its own and makes the names
 * unreadable is not a template.
 *
 * Generated rather than downloaded: no licence to track, no network to fail,
 * and the same artwork on every database.
 */

const W = 1080;
const H = 1920;

const svg = (body, defs = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<defs>${defs}</defs>${body}</svg>`;

/** The same piece in all four corners, mirrored — drawn once for the top-left. */
const corners = (piece) =>
    `<g>${piece}</g>`
    + `<g transform="translate(${W} 0) scale(-1 1)">${piece}</g>`
    + `<g transform="translate(0 ${H}) scale(1 -1)">${piece}</g>`
    + `<g transform="translate(${W} ${H}) scale(-1 -1)">${piece}</g>`;

/** Top-left and bottom-right only — a diagonal pair reads as a composed card. */
const diagonal = (piece) =>
    `<g>${piece}</g><g transform="translate(${W} ${H}) scale(-1 -1)">${piece}</g>`;

const rectLine = (inset, color, width, rx = 0, opacity = 1) =>
    `<rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" rx="${rx}" `
    + `fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;

/** A five-petal flower with a centre. */
const flower = (cx, cy, r, petal, centre, opacity = 1) => {
    const petals = Array.from({ length: 5 }, (_, i) => {
        const a = (i * 72 - 90) * (Math.PI / 180);
        const px = cx + Math.cos(a) * r * 0.62;
        const py = cy + Math.sin(a) * r * 0.62;
        return `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${(r * 0.46).toFixed(1)}" ry="${(r * 0.62).toFixed(1)}" `
            + `transform="rotate(${i * 72} ${px.toFixed(1)} ${py.toFixed(1)})" fill="${petal}"/>`;
    }).join('');
    return `<g opacity="${opacity}">${petals}<circle cx="${cx}" cy="${cy}" r="${(r * 0.26).toFixed(1)}" fill="${centre}"/></g>`;
};

/** A leaf: a pointed ellipse from (x, y), `len` long, turned `deg`. */
const leaf = (x, y, len, deg, color, opacity = 1) =>
    `<path d="M0 0 Q${(len * 0.5).toFixed(1)} ${(-len * 0.28).toFixed(1)} ${len} 0 Q${(len * 0.5).toFixed(1)} ${(len * 0.28).toFixed(1)} 0 0 Z" `
    + `transform="translate(${x} ${y}) rotate(${deg})" fill="${color}" opacity="${opacity}"/>`;

/** A four-point sparkle. */
const sparkle = (cx, cy, r, color, opacity = 1) =>
    `<path d="M${cx} ${cy - r} Q${cx + r * 0.16} ${cy - r * 0.16} ${cx + r} ${cy} Q${cx + r * 0.16} ${cy + r * 0.16} ${cx} ${cy + r} `
    + `Q${cx - r * 0.16} ${cy + r * 0.16} ${cx - r} ${cy} Q${cx - r * 0.16} ${cy - r * 0.16} ${cx} ${cy - r} Z" fill="${color}" opacity="${opacity}"/>`;

/** Rings of petals round a point — a mandala. `rings` is [[radius, count, petalLength]]. */
const mandala = (cx, cy, rings, color, opacity = 1, width = 3) => {
    const parts = rings.map(([radius, count, len]) =>
        Array.from({ length: count }, (_, i) => {
            const deg = (i * 360) / count;
            return `<path d="M0 ${-radius} Q${(len * 0.34).toFixed(1)} ${(-radius - len * 0.5).toFixed(1)} 0 ${-radius - len} `
                + `Q${(-len * 0.34).toFixed(1)} ${(-radius - len * 0.5).toFixed(1)} 0 ${-radius} Z" transform="rotate(${deg.toFixed(2)})"/>`;
        }).join('')
        + `<circle r="${radius}"/>`
    ).join('');
    return `<g transform="translate(${cx} ${cy})" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}">${parts}</g>`;
};

/* ───────────────────────────────── classic ───────────────────────────────── */

const CLASSIC = { bg: '#FFF8EF', gold: '#B08A3E', rose: '#E3A0AC', blush: '#F4CBD1', sage: '#8FA98A', deep: '#C97B8B' };

/** A spray of roses and leaves for one corner. */
const classicSpray = (p) => [
    leaf(150, 250, 190, 52, p.sage, 0.9), leaf(250, 150, 190, 38, p.sage, 0.9),
    leaf(120, 150, 150, 100, p.sage, 0.75), leaf(150, 120, 150, -10, p.sage, 0.75),
    leaf(300, 110, 130, 12, p.sage, 0.6), leaf(110, 300, 130, 78, p.sage, 0.6),
    flower(170, 170, 96, p.rose, p.gold),
    flower(300, 96, 58, p.blush, p.deep),
    flower(96, 300, 58, p.blush, p.deep),
    flower(390, 150, 36, p.rose, p.gold, 0.9),
    flower(150, 390, 36, p.rose, p.gold, 0.9),
].join('');

const classicFrame = () => svg(
    rectLine(44, CLASSIC.gold, 5, 6) + rectLine(64, CLASSIC.gold, 2, 4, 0.8) + diagonal(classicSpray(CLASSIC))
);

const classicImage = () => svg(
    `<rect width="${W}" height="${H}" fill="${CLASSIC.bg}"/>`
    + `<rect width="${W}" height="${H}" fill="url(#wash)"/>`
    + `<ellipse cx="900" cy="420" rx="420" ry="380" fill="${CLASSIC.blush}" opacity="0.30" filter="url(#soft)"/>`
    + `<ellipse cx="160" cy="1500" rx="420" ry="380" fill="#F6E2C6" opacity="0.45" filter="url(#soft)"/>`
    + rectLine(44, CLASSIC.gold, 5, 6) + rectLine(64, CLASSIC.gold, 2, 4, 0.8)
    + diagonal(classicSpray(CLASSIC)),
    `<linearGradient id="wash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFDF8"/><stop offset="1" stop-color="#FBEFE2"/></linearGradient>`
    + `<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>`
);

const classicCustom = () => {
    const scatter = Array.from({ length: 26 }, (_, i) => {
        const x = 90 + ((i * 397) % 900);
        const y = 110 + ((i * 631) % 1700);
        const r = 26 + ((i * 7) % 26);
        return flower(x, y, r, i % 2 ? CLASSIC.blush : CLASSIC.rose, CLASSIC.gold, 0.28)
            + leaf(x + r, y + r * 0.6, r * 1.5, 35 + (i * 23) % 60, CLASSIC.sage, 0.22);
    }).join('');
    return svg(
        `<rect width="${W}" height="${H}" fill="${CLASSIC.bg}"/><rect width="${W}" height="${H}" fill="url(#wash)"/>${scatter}`,
        `<linearGradient id="wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF4EC"/><stop offset="1" stop-color="#FBE9EC"/></linearGradient>`
    );
};

/* ────────────────────────────────── royal ────────────────────────────────── */

const ROYAL = { bg: '#14213D', deep: '#0B1430', gold: '#E0B03A', pale: '#F3D98B', plum: '#3B2A6B' };

/** A quarter fan for one corner. */
const royalFan = (p) =>
    `<g transform="translate(70 70)" fill="none" stroke="${p.gold}" stroke-width="4">`
    + [70, 120, 170, 220].map((r) => `<path d="M${r} 0 A${r} ${r} 0 0 1 0 ${r}"/>`).join('')
    + Array.from({ length: 6 }, (_, i) => {
        const a = (i * 18) * (Math.PI / 180);
        return `<line x1="0" y1="0" x2="${(Math.cos(a) * 220).toFixed(1)}" y2="${(Math.sin(a) * 220).toFixed(1)}" opacity="0.7"/>`;
    }).join('')
    + `</g>`
    + sparkle(70, 70, 26, p.pale);

/** The crest at the top centre: a diamond between two flourishes. */
const royalCrest = (p, y) =>
    `<g transform="translate(${W / 2} ${y})" fill="none" stroke="${p.gold}" stroke-width="4">`
    + `<path d="M0 -34 L26 0 L0 34 L-26 0 Z" fill="${p.gold}"/>`
    + `<path d="M40 0 C90 -40 150 -40 200 0 M40 0 C90 40 150 40 200 0"/>`
    + `<path d="M-40 0 C-90 -40 -150 -40 -200 0 M-40 0 C-90 40 -150 40 -200 0"/>`
    + `<circle cx="218" cy="0" r="7" fill="${p.gold}"/><circle cx="-218" cy="0" r="7" fill="${p.gold}"/>`
    + `</g>`;

const royalBorder = (p) =>
    rectLine(40, p.gold, 8) + rectLine(62, p.gold, 2, 0, 0.85) + rectLine(74, p.pale, 1, 0, 0.6)
    + corners(royalFan(p)) + royalCrest(p, 40) + royalCrest(p, H - 40);

const royalFrame = () => svg(royalBorder(ROYAL));

const royalImage = () => svg(
    `<rect width="${W}" height="${H}" fill="${ROYAL.deep}"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`
    + `<rect width="${W}" height="${H}" fill="url(#damask)"/>` + royalBorder(ROYAL),
    `<radialGradient id="glow" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#27407A"/><stop offset="1" stop-color="${ROYAL.deep}"/></radialGradient>`
    + `<pattern id="damask" width="120" height="120" patternUnits="userSpaceOnUse">`
    + `<path d="M60 14 Q82 60 60 106 Q38 60 60 14 Z" fill="${ROYAL.gold}" opacity="0.07"/>`
    + `<circle cx="0" cy="0" r="5" fill="${ROYAL.gold}" opacity="0.10"/><circle cx="120" cy="0" r="5" fill="${ROYAL.gold}" opacity="0.10"/>`
    + `<circle cx="0" cy="120" r="5" fill="${ROYAL.gold}" opacity="0.10"/><circle cx="120" cy="120" r="5" fill="${ROYAL.gold}" opacity="0.10"/></pattern>`
);

const royalCustom = () => svg(
    `<rect width="${W}" height="${H}" fill="url(#night)"/><rect width="${W}" height="${H}" fill="url(#lattice)"/>`
    + mandala(W / 2, 250, [[60, 12, 70], [150, 18, 60]], ROYAL.gold, 0.30)
    + mandala(W / 2, H - 250, [[60, 12, 70], [150, 18, 60]], ROYAL.gold, 0.30),
    `<linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ROYAL.bg}"/><stop offset="0.55" stop-color="${ROYAL.plum}"/><stop offset="1" stop-color="${ROYAL.deep}"/></linearGradient>`
    + `<pattern id="lattice" width="96" height="96" patternUnits="userSpaceOnUse">`
    + `<path d="M48 0 L96 48 L48 96 L0 48 Z" fill="none" stroke="${ROYAL.gold}" stroke-width="1.5" opacity="0.16"/>`
    + `<circle cx="48" cy="48" r="4" fill="${ROYAL.gold}" opacity="0.18"/></pattern>`
);

/* ───────────────────────────────── minimal ───────────────────────────────── */

const MINIMAL = { bg: '#FAFAF7', ink: '#2F3A4A', sage: '#9DB5A0', sand: '#E8DCC8', blush: '#EBD3CE' };

/** A small upright sprig, centred on x, growing up from y. */
const sprig = (x, y, p, flip = 1) =>
    `<g transform="translate(${x} ${y}) scale(1 ${flip})">`
    + `<path d="M0 0 C0 -50 0 -90 0 -150" fill="none" stroke="${p.ink}" stroke-width="3" stroke-linecap="round"/>`
    + [[-30, -1], [-62, 1], [-94, -1], [-126, 1]].map(([dy, side]) =>
        leaf(0, dy, 62, side > 0 ? -32 : 212, p.sage)).join('')
    + `</g>`;

const minimalLines = (p) => rectLine(56, p.ink, 2.5) + rectLine(76, p.ink, 1, 0, 0.45);

const minimalFrame = () => svg(
    minimalLines(MINIMAL) + sprig(W / 2, 190, MINIMAL) + sprig(W / 2, H - 190, MINIMAL, -1)
);

const minimalImage = () => svg(
    `<rect width="${W}" height="${H}" fill="${MINIMAL.bg}"/>`
    + `<circle cx="930" cy="230" r="330" fill="${MINIMAL.sage}" opacity="0.26"/>`
    + `<circle cx="120" cy="1720" r="360" fill="${MINIMAL.sand}" opacity="0.55"/>`
    + `<circle cx="980" cy="1640" r="150" fill="${MINIMAL.blush}" opacity="0.45"/>`
    + minimalLines(MINIMAL) + sprig(W / 2, 190, MINIMAL) + sprig(W / 2, H - 190, MINIMAL, -1)
);

const minimalCustom = () => svg(
    `<rect width="${W}" height="${H}" fill="${MINIMAL.bg}"/>`
    + `<circle cx="200" cy="330" r="300" fill="${MINIMAL.sand}" opacity="0.50"/>`
    + `<circle cx="900" cy="640" r="250" fill="${MINIMAL.sage}" opacity="0.26"/>`
    + `<circle cx="210" cy="1190" r="220" fill="${MINIMAL.blush}" opacity="0.40"/>`
    + `<circle cx="860" cy="1560" r="330" fill="${MINIMAL.sand}" opacity="0.45"/>`
    + `<path d="M-40 980 C240 880 520 1080 800 960 S1160 900 1160 900" fill="none" stroke="${MINIMAL.ink}" stroke-width="2" opacity="0.18"/>`
    + `<path d="M-40 1040 C240 940 520 1140 800 1020 S1160 960 1160 960" fill="none" stroke="${MINIMAL.ink}" stroke-width="2" opacity="0.12"/>`
);

/* ───────────────────────────────── elegant ───────────────────────────────── */

const ELEGANT = { bg: '#2B1B3D', deep: '#1B1029', gold: '#D9B26A', pale: '#F1DDB0', plum: '#7B3FA0' };

/** Art-deco arcs stepping out of one corner. */
const decoCorner = (p) =>
    `<g fill="none" stroke="${p.gold}" stroke-width="3.5">`
    + [110, 160, 210, 260].map((r, i) => `<path d="M${52 + r} 52 A${r} ${r} 0 0 1 52 ${52 + r}" opacity="${1 - i * 0.18}"/>`).join('')
    + `<path d="M52 52 L190 190" opacity="0.6"/>`
    + `</g>`
    + sparkle(196, 196, 22, p.pale) + sparkle(330, 110, 12, p.pale, 0.8) + sparkle(110, 330, 12, p.pale, 0.8);

const elegantBorder = (p) =>
    rectLine(52, p.gold, 4) + rectLine(70, p.pale, 1.2, 0, 0.7) + corners(decoCorner(p));

/** A repeatable scatter: the same seed always gives the same points. */
const scatterPoints = (count, seed) => {
    let state = seed;
    const next = () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
    return Array.from({ length: count }, () => [next(), next(), next()]);
};

const elegantSparkles = (p, opacity) => scatterPoints(40, 7).map(([rx, ry, rs]) => {
    const x = 60 + rx * 960;
    const y = 60 + ry * 1800;
    const i = Math.floor(rs * 12);
    // Fewer and fainter through the middle band, where the words sit.
    const middle = x > 230 && x < 850 && y > 330 && y < 1590;
    return sparkle(Math.round(x), Math.round(y), 6 + i, p.pale, middle ? opacity * 0.35 : opacity);
}).join('');

const elegantFrame = () => svg(elegantBorder(ELEGANT));

const elegantImage = () => svg(
    `<rect width="${W}" height="${H}" fill="${ELEGANT.deep}"/><rect width="${W}" height="${H}" fill="url(#aura)"/>`
    + elegantSparkles(ELEGANT, 0.7) + elegantBorder(ELEGANT),
    `<radialGradient id="aura" cx="0.5" cy="0.42" r="0.8"><stop offset="0" stop-color="#5A2E7E"/><stop offset="0.6" stop-color="${ELEGANT.bg}"/><stop offset="1" stop-color="${ELEGANT.deep}"/></radialGradient>`
);

const elegantCustom = () => {
    const bokeh = scatterPoints(22, 19).map(([rx, ry, rs], i) => {
        const x = Math.round(rx * W);
        const y = Math.round(ry * H);
        const r = Math.round(40 + rs * 110);
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 3 ? ELEGANT.gold : '#FFFFFF'}" opacity="${0.05 + (i % 4) * 0.02}"/>`;
    }).join('');
    return svg(
        `<rect width="${W}" height="${H}" fill="url(#dusk)"/>${bokeh}${elegantSparkles(ELEGANT, 0.55)}`,
        `<linearGradient id="dusk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3A1F5C"/><stop offset="0.55" stop-color="${ELEGANT.plum}"/><stop offset="1" stop-color="#C77F6B"/></linearGradient>`
    );
};

/* ─────────────────────────────── traditional ─────────────────────────────── */

const TRADITIONAL = { bg: '#7A1220', deep: '#5A0B16', gold: '#E6BE5A', pale: '#F6E2A6', saffron: '#D9782B' };

/** A scalloped garland (toran) hanging from the top edge. */
const toran = (p, y, flip = 1) => {
    const count = 9;
    const step = (W - 160) / count;
    const drops = Array.from({ length: count }, (_, i) => {
        const x = 80 + step * i;
        const mid = x + step / 2;
        return `<path d="M${x.toFixed(1)} 0 Q${mid.toFixed(1)} ${86} ${(x + step).toFixed(1)} 0" fill="none" stroke="${p.gold}" stroke-width="5"/>`
            + `<path d="M${mid.toFixed(1)} 44 l14 26 l-14 26 l-14 -26 Z" fill="${p.gold}"/>`
            + `<circle cx="${mid.toFixed(1)}" cy="110" r="7" fill="${p.pale}"/>`;
    }).join('');
    return `<g transform="translate(0 ${y}) scale(1 ${flip})">${drops}</g>`;
};

const traditionalBorder = (p) =>
    rectLine(40, p.gold, 8) + rectLine(60, p.gold, 2, 0, 0.9)
    + toran(p, 70) + toran(p, H - 70, -1)
    + corners(mandala(60, 60, [[36, 10, 40], [92, 14, 44]], p.gold, 0.95, 3.5));

const traditionalFrame = () => svg(traditionalBorder(TRADITIONAL));

const traditionalImage = () => svg(
    `<rect width="${W}" height="${H}" fill="${TRADITIONAL.deep}"/><rect width="${W}" height="${H}" fill="url(#ember)"/>`
    + mandala(W / 2, H / 2, [[120, 16, 90], [260, 24, 90], [400, 32, 80]], TRADITIONAL.gold, 0.10, 4)
    + traditionalBorder(TRADITIONAL),
    `<radialGradient id="ember" cx="0.5" cy="0.5" r="0.8"><stop offset="0" stop-color="#9C1B2C"/><stop offset="1" stop-color="${TRADITIONAL.deep}"/></radialGradient>`
);

const traditionalCustom = () => svg(
    `<rect width="${W}" height="${H}" fill="url(#silk)"/><rect width="${W}" height="${H}" fill="url(#butti)"/>`
    + mandala(W / 2, 280, [[70, 12, 70], [170, 20, 64]], TRADITIONAL.gold, 0.32)
    + mandala(W / 2, H - 280, [[70, 12, 70], [170, 20, 64]], TRADITIONAL.gold, 0.32),
    `<linearGradient id="silk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TRADITIONAL.bg}"/><stop offset="0.5" stop-color="#93202B"/><stop offset="1" stop-color="${TRADITIONAL.deep}"/></linearGradient>`
    + `<pattern id="butti" width="110" height="110" patternUnits="userSpaceOnUse">`
    + `<path d="M55 30 Q72 55 55 80 Q38 55 55 30 Z" fill="${TRADITIONAL.gold}" opacity="0.16"/>`
    + `<circle cx="55" cy="22" r="4" fill="${TRADITIONAL.gold}" opacity="0.2"/>`
    + `<circle cx="0" cy="0" r="3" fill="${TRADITIONAL.pale}" opacity="0.18"/><circle cx="110" cy="110" r="3" fill="${TRADITIONAL.pale}" opacity="0.18"/></pattern>`
);

module.exports = {
    classic: { frame: classicFrame, image: classicImage, custom: classicCustom },
    royal: { frame: royalFrame, image: royalImage, custom: royalCustom },
    minimal: { frame: minimalFrame, image: minimalImage, custom: minimalCustom },
    elegant: { frame: elegantFrame, image: elegantImage, custom: elegantCustom },
    traditional: { frame: traditionalFrame, image: traditionalImage, custom: traditionalCustom },
};
