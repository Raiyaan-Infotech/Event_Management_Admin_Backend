#!/usr/bin/env node
/**
 * Sample fonts for Templates → Fonts.
 *
 *   node src/database/seeders/template-fonts.seeder.js                  (dry run, local)
 *   node src/database/seeders/template-fonts.seeder.js --apply
 *   node src/database/seeders/template-fonts.seeder.js --prod --apply
 *
 * Forty-two fonts, all LINK fonts (Google Fonts stylesheets), so nothing has
 * to be uploaded to storage and the same rows work on any database: the ten
 * the template wizard used to carry in its own code, eight invitation-style
 * additions, and a curated set of twenty-four — scripts for the names, serifs
 * for headings and dates, sans for the small lines. The wizard no longer has
 * a list of its own —
 * what is in this table is what it offers.
 *
 * ── THE NAME IS THE FAMILY ───────────────────────────────────────────
 * A stylesheet link declares its own family name, and the browser is asked
 * for the font by the row's `name`. They must be the same words, which is why
 * each link below is built FROM the name rather than typed beside it.
 *
 * Re-runnable: a font whose name already exists for the company (live or
 * soft-deleted) is left alone, so a second run reports zeros.
 *
 * Needs `template_fonts` — run `src/database/tools/apply-template-fonts.js`
 * first on a database that does not have it. This seeder says so and stops.
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const COMPANY_ID = 1;

/** name → the weights worth loading (a script face has only one). */
const FONTS = [
    // The ten the template wizard used to have built in (Jamal, 2026-10-06:
    // the wizard's font lists come from THIS module and nowhere else). They
    // are rows like any other now, so a template that names one still finds
    // it, and the admin can switch one off or delete it.
    ['Playfair Display', '400;600;700'],
    ['Poppins', '300;400;500;600'],
    ['Great Vibes', null],
    ['Cormorant Garamond', '400;500;600;700'],
    ['Montserrat', '300;400;500;600'],
    ['Lora', '400;500;600;700'],
    ['Cinzel', '400;600;700'],
    ['Dancing Script', '400;600;700'],
    ['Marcellus', null],
    ['Inter', '300;400;500;600'],
    // Invitation-style additions.
    ['Parisienne', null],
    ['Sacramento', null],
    ['Alex Brush', null],
    ['Allura', null],
    ['Pinyon Script', null],
    ['Tangerine', '400;700'],
    ['Libre Baskerville', '400;700'],
    ['Josefin Sans', '300;400;600'],

    // A wider, curated set (Jamal, 2026-10-06: "better fonts"). Every link
    // was asked for and answered with a stylesheet declaring that family.
    // Calligraphy and script — for the names.
    ['Italianno', null],
    ['Monsieur La Doulaise', null],
    ['Rouge Script', null],
    ['Petit Formal Script', null],
    ['Mrs Saint Delafield', null],
    ['Herr Von Muellerhoff', null],
    ['Imperial Script', null],
    ['Corinthia', '400;700'],
    ['Luxurious Script', null],
    ['WindSong', '400;500'],
    // Serif and display — for headings, dates and body lines.
    ['Cormorant', '400;500;600'],
    ['EB Garamond', '400;500;600'],
    ['Bodoni Moda', '400;500;600'],
    ['Cinzel Decorative', '400;700'],
    ['Prata', null],
    ['Gilda Display', null],
    ['Forum', null],
    ['Italiana', null],
    ['Old Standard TT', '400;700'],
    ['Libre Caslon Text', '400;700'],
    // Sans — for the small lines.
    ['Raleway', '300;400;500;600'],
    ['Jost', '300;400;500'],
    ['Tenor Sans', null],
    ['Lato', '300;400;700'],
];

const linkFor = (name, weights) =>
    `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}${weights ? `:wght@${weights}` : ''}&display=swap`;

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const l of raw.split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

(async () => {
    const env = PROD ? parseEnv('.env.production') : localEnv;
    const conn = await mysql.createConnection({
        host: env.DB_HOST,
        port: env.DB_PORT || 3306,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        charset: 'utf8mb4',
        ssl: PROD && env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : undefined,
    });

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}`);

    const [[table]] = await conn.query(
        `SELECT COUNT(*) n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'template_fonts'`
    );
    if (!table.n) {
        console.log('template_fonts does not exist here. Run apply-template-fonts.js first.');
        await conn.end();
        process.exit(1);
    }

    // One read for all eight, not one per font — production is slow per query.
    const [existing] = await conn.query(
        'SELECT name FROM template_fonts WHERE company_id = ? AND name IN (?)',
        [COMPANY_ID, FONTS.map(([name]) => name)]
    );
    const have = new Set(existing.map((r) => r.name.toLowerCase()));
    const missing = FONTS.filter(([name]) => !have.has(name.toLowerCase()));

    console.log(`already present: ${FONTS.length - missing.length}   to add: ${missing.length}`);
    for (const [name, weights] of missing) console.log(`  + ${name}   ${linkFor(name, weights)}`);

    if (!missing.length) {
        console.log('Nothing to do.');
        await conn.end();
        return;
    }
    if (!APPLY) {
        console.log('\nDry run — nothing changed. Re-run with --apply.');
        await conn.end();
        return;
    }

    // One INSERT for all of them.
    const [res] = await conn.query(
        'INSERT INTO template_fonts (name, source, link_url, is_active, company_id) VALUES ?',
        [missing.map(([name, weights]) => [name, 'link', linkFor(name, weights), 1, COMPANY_ID])]
    );
    console.log(`added: ${res.affectedRows}`);

    const [[total]] = await conn.query(
        'SELECT COUNT(*) n FROM template_fonts WHERE company_id = ? AND deleted_at IS NULL', [COMPANY_ID]
    );
    console.log(`live fonts now: ${total.n}`);
    await conn.end();
})().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
