#!/usr/bin/env node
/**
 * Vintage frame styles for Templates → Frame Styles.
 *
 *   node src/database/seeders/frame-styles-vintage.seeder.js                  (dry run, local)
 *   node src/database/seeders/frame-styles-vintage.seeder.js --apply
 *   node src/database/seeders/frame-styles-vintage.seeder.js --prod           (dry run, production)
 *   node src/database/seeders/frame-styles-vintage.seeder.js --prod --apply
 *
 * Fourteen borders, each in Gold (for a dark card) and Bronze (for a light
 * one) — 28 frame styles. A frame keeps the colour it was made in, which is
 * why there are two of each.
 *
 * ── REAL DRAWINGS, NOT GENERATED ───────────────────────────────────────────
 * (Jamal, 2026-10-06: the frames in the catalogue "all look the same", and
 * anything drawn by code "looks AI generated".) These are public-domain
 * engravings, Art Nouveau and Art Deco borders from Wikimedia Commons. Each
 * was turned from black-on-white into one colour on a clear background and
 * cropped so its window sits on the card's text box (11% in from the sides,
 * 13% from top and bottom), so an invitation's words never run into the
 * ornament. The finished 1080 x 1920 PNGs and the list of where each came
 * from are in `assets/frames/` (`manifest.json`: name, file, category, source
 * file on Commons, licence — every one "Public domain").
 *
 * ── IT ONLY ADDS ───────────────────────────────────────────────────────────
 * A frame is matched by its name; one that exists — live or deleted — is
 * skipped, never changed. A frame's category is looked up by slug and left
 * empty if that category does not exist here. Nothing else is touched.
 */
require('dotenv').config({
    path: process.argv.includes('--prod') ? '.env.production' : '.env',
});

const fs = require('fs');
const path = require('path');
const db = require('../../models');
const mediaService = require('../../services/media.service');

const { FrameStyle, TemplateCategory } = db;

const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const COMPANY_ID = 1;
const DIR = path.join(__dirname, 'assets', 'frames');
const FRAMES = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

(async () => {
    console.log(`\n  frame-styles-vintage — ${PROD ? 'PRODUCTION' : 'LOCAL'}${APPLY ? '' : '  (DRY RUN)'}\n`);

    const [categories, existing, maxSort] = await Promise.all([
        TemplateCategory.findAll({ where: { company_id: COMPANY_ID }, attributes: ['id', 'slug'] }),
        // paranoid: false — a soft-deleted frame still holds its name.
        FrameStyle.findAll({
            where: { company_id: COMPANY_ID, name: FRAMES.map((f) => f.name) },
            attributes: ['id', 'name'],
            paranoid: false,
        }),
        FrameStyle.max('sort_order', { where: { company_id: COMPANY_ID } }),
    ]);

    const categoryId = new Map(categories.map((c) => [c.slug, c.id]));
    const taken = new Set(existing.map((f) => f.name));
    const todo = FRAMES.filter((f) => !taken.has(f.name));

    for (const f of FRAMES) {
        console.log(`  ${taken.has(f.name) ? 'skip  ' : 'create'}  ${f.name.padEnd(26)} ${f.category}`);
    }
    console.log(`\n  ${todo.length} to create · ${taken.size} already there`);

    if (!APPLY) {
        console.log('  Dry run — nothing changed. Re-run with --apply.\n');
        process.exit(0);
    }

    let sort = Number(maxSort) || 0;
    for (const f of todo) {
        const buffer = fs.readFileSync(path.join(DIR, f.file));
        const stored = await mediaService.upload(
            { buffer, mimetype: 'image/png', size: buffer.length, originalname: f.file },
            { folder: 'frame-styles' },
            COMPANY_ID
        );
        sort += 1;
        const row = await FrameStyle.create({
            company_id: COMPANY_ID,
            name: f.name,
            template_category_id: categoryId.get(f.category) ?? null,
            file_url: stored.url,
            file_name: f.file,
            supported_layouts: ['portrait'],
            status: 'published',
            is_active: 1,
            sort_order: sort,
        });
        console.log(`  created  ${row.name} (#${row.id})`);
    }

    const total = await FrameStyle.count({ where: { company_id: COMPANY_ID } });
    console.log(`\n  ${todo.length} created · frame styles now: ${total}\n`);
    process.exit(0);
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
