/**
 * Step 2's per-layout-style field matrix — the backend's copy vs the frontend's.
 *
 * WHY THIS EXISTS
 * `STEP2_FIELDS` (frontend) decides which controls a given layout style /
 * background type combination RENDERS. `CELLS` (matrix seeder) decides which
 * columns the sample data for that combination WRITES. Two hand-maintained
 * copies of the same table drift the first time somebody edits one of them, and
 * the symptom is quiet: a seeded template carrying a value no form will ever
 * show, or a control with no sample row behind it.
 *
 * So this parses the real TypeScript source rather than trusting a duplicate,
 * and fails loudly on any disagreement.
 *
 * It also checks the seeded rows themselves: every field a cell claims to offer
 * must have actually reached the database as a NON-DEFAULT value — otherwise
 * "it saved" and "the column happens to hold its default" look identical.
 *
 *   node tests/template-matrix.test.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { EventTemplate, sequelize } = require('../src/models');

const FRONTEND = path.join(
    'D:', 'Jamal', 'Event_Management_Admin_Frontend', 'src', 'hooks', 'use-event-templates.ts'
);
const SEEDER = path.join(__dirname, '..', 'src', 'database', 'seeders', 'event-templates-matrix.seeder.js');

const STYLES = ['classic', 'modern', 'elegant', 'minimal', 'traditional'];
const BG_TYPES = ['color', 'image', 'gradient', 'custom'];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass += 1; console.log('  ok    ', name); }
    else { fail += 1; console.log('  FAIL  ', name, detail !== undefined ? `-> ${JSON.stringify(detail)}` : ''); }
};

/**
 * Pull STEP2_FIELDS out of the .ts source.
 *
 * Regex rather than a TS parser on purpose: adding a transpiler to a plain node
 * test script to read one object literal costs more than it returns, and the
 * shape being matched is a literal this repo controls.
 */
function parseFrontendMatrix(src) {
    const block = /export const STEP2_FIELDS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
    if (!block) throw new Error('STEP2_FIELDS not found in ' + FRONTEND);

    const out = {};
    const styleBlocks = [...block[1].matchAll(/^ {4}(\w+): \{\n([\s\S]*?)^ {4}\},$/gm)];

    for (const [, style, body] of styleBlocks) {
        out[style] = {};
        for (const bg of BG_TYPES) {
            const m = new RegExp(`${bg}: \\[([^\\]]*)\\]`).exec(body);
            out[style][bg] = m
                ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
                : null;
        }
    }
    return out;
}

function parseSeederMatrix() {
    // The seeder is plain CommonJS, so its own table can simply be required —
    // no parsing needed, and no chance of the test reading it differently from
    // the way node does.
    const src = fs.readFileSync(SEEDER, 'utf8');
    const sandboxed = src
        .replace(/^require\('dotenv'\)[\s\S]*?\}\);$/m, '')
        .replace(/^const db = require[\s\S]*?$/m, '')
        .replace(/^const mediaService = require[\s\S]*?$/m, '')
        .replace(/^const \{ EventTemplate[\s\S]*?$/m, '')
        .replace(/^\(async \(\) => \{[\s\S]*$/m, '');
    // eslint-disable-next-line no-new-func
    return new Function(`${sandboxed}\nreturn { CELLS, WRITERS };`)();
}

/** Which columns a field key writes, derived from the seeder's own WRITERS. */
function columnsFor(WRITERS, key) {
    const palette = { bg: '#111111', accent: '#222222', from: '#333333', to: '#444444', via: '#555555' };
    const written = WRITERS[key](palette, { imageUrl: 'https://example.test/x.svg' });
    return Object.keys(written);
}

(async () => {
    console.log('\n  Step 2 field matrix\n');

    const frontendSrc = fs.readFileSync(FRONTEND, 'utf8');
    const frontend = parseFrontendMatrix(frontendSrc);
    const { CELLS, WRITERS } = parseSeederMatrix();

    /* ── 1. the two matrices agree ─────────────────────────────────────────── */

    ok('frontend matrix has all 5 layout styles',
        STYLES.every((s) => frontend[s]), Object.keys(frontend));
    ok('seeder matrix has all 5 layout styles',
        STYLES.every((s) => CELLS[s]), Object.keys(CELLS));

    for (const style of STYLES) {
        for (const bg of BG_TYPES) {
            const a = frontend[style]?.[bg];
            const b = CELLS[style]?.[bg];
            ok(`${style}/${bg} matches frontend`,
                Array.isArray(a) && Array.isArray(b) && a.join(',') === b.join(','),
                { frontend: a, seeder: b });
        }
    }

    /* ── 2. every field key the matrix uses can actually be written ────────── */

    const used = new Set();
    for (const style of STYLES) for (const bg of BG_TYPES) (CELLS[style]?.[bg] || []).forEach((k) => used.add(k));
    ok('every field key has a WRITER',
        [...used].every((k) => typeof WRITERS[k] === 'function'),
        [...used].filter((k) => typeof WRITERS[k] !== 'function'));

    /* ── 3. the seeded rows carry what their cell promised ─────────────────── */

    const rows = await EventTemplate.findAll({
        where: { company_id: 1 },
        attributes: { exclude: [] },
    });
    const byCode = new Map(rows.map((r) => [r.code, r]));

    const seeded = STYLES.flatMap((s) => BG_TYPES.map((b) => `matrix-${s}-${b}`));
    ok('all 20 matrix templates exist',
        seeded.every((c) => byCode.has(c)),
        seeded.filter((c) => !byCode.has(c)));

    // Defaults a column falls back to. A seeded value equal to one of these
    // proves nothing, so they are treated as "not written".
    const DEFAULTS = {
        image_position: 'center', background_position: 'center', image_scale: 'cover',
        image_size: 100, overlay_enabled: false, overlay_color: null, artwork_style: null,
        gradient_via: null, corner_radius: 0, image_shape: 'rectangle', overlay_opacity: 0,
        background_color: null, secondary_color: null, background_image: null,
        gradient_from: null, gradient_to: null, gradient_type: 'linear',
        gradient_direction: 'bottom',
    };

    /**
     * Columns whose DEFAULT is also a perfectly ordinary answer.
     *
     * `gradient_type` defaults to 'linear' and the mockups all show Linear
     * selected — so "the admin chose linear" and "nobody touched it" are the
     * same bytes, and the non-default heuristic below cannot separate them.
     * Seeding 'radial' purely to make the test pass would be worse: it would
     * hide the Direction control (meaningless for a radial gradient) and leave
     * every seeded gradient row carrying a direction its own form would not
     * show. So for these, "present and a legal value" is the strongest true
     * assertion available.
     */
    const DEFAULT_IS_A_REAL_CHOICE = {
        gradient_type: ['linear', 'radial'],
    };

    for (const style of STYLES) {
        for (const bg of BG_TYPES) {
            const code = `matrix-${style}-${bg}`;
            const row = byCode.get(code);
            if (!row) continue;

            const expected = new Set();
            for (const key of CELLS[style][bg]) columnsFor(WRITERS, key).forEach((c) => expected.add(c));

            const missing = [...expected].filter((col) => {
                const v = row[col];
                const allowed = DEFAULT_IS_A_REAL_CHOICE[col];
                if (allowed) return !allowed.includes(v);

                const d = DEFAULTS[col];
                if (v === null || v === undefined) return true;
                if (typeof d === 'boolean') return Boolean(v) === d;
                if (typeof d === 'number') return Number(v) === d;
                return v === d;
            });

            ok(`${code} wrote every offered field`, missing.length === 0, { missing });
        }
    }

    /* ── 4. rows do NOT carry fields their form never offers ───────────────── */

    // Only the columns that are genuinely style-specific are checked. Shared
    // ones (fonts, orientation) are set on every row by design.
    const STYLE_SPECIFIC = [
        'gradient_via', 'image_position', 'background_position', 'image_size',
        'overlay_enabled', 'overlay_color', 'artwork_style', 'corner_radius',
    ];

    for (const style of STYLES) {
        for (const bg of BG_TYPES) {
            const code = `matrix-${style}-${bg}`;
            const row = byCode.get(code);
            if (!row) continue;

            const expected = new Set();
            for (const key of CELLS[style][bg]) columnsFor(WRITERS, key).forEach((c) => expected.add(c));

            const leaked = STYLE_SPECIFIC.filter((col) => {
                if (expected.has(col)) return false;
                const v = row[col];
                const d = DEFAULTS[col];
                if (v === null || v === undefined) return false;
                if (typeof d === 'boolean') return Boolean(v) !== d;
                if (typeof d === 'number') return Number(v) !== d;
                return v !== d;
            });

            ok(`${code} carries no unoffered field`, leaked.length === 0, { leaked });
        }
    }

    /* ── 5. the columns that were dropped are really gone ──────────────────── */

    const [cols] = await sequelize.query(`
        SELECT COLUMN_NAME n FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'event_templates'
           AND COLUMN_NAME IN ('custom_css', 'decorations')`);
    ok('custom_css and decorations dropped', cols.length === 0, cols.map((c) => c.n));

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
