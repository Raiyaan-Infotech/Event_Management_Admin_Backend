/**
 * Template Categories + Frame Styles — service-level regression test.
 *
 * Runs against the LOCAL database through the services directly, not over HTTP:
 * the rules being checked here (slug uniqueness across soft-deletes, layout
 * normalisation, the category guard) all live in the service, and going through
 * Express would only add an auth session to the setup without testing anything
 * more.
 *
 *   node tests/frame-styles-api.test.js
 *
 * Every row it creates is named `zz-test-*` and hard-deleted at the end, so it
 * is safe to re-run.
 */

const categories = require('../src/services/templateCategory.service');
const frames = require('../src/services/frameStyle.service');
const { TemplateCategory, FrameStyle } = require('../src/models');
const { Op } = require('sequelize');

const PREFIX = 'zz-test';
let pass = 0;
let fail = 0;

const check = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        pass += 1;
        console.log(`  ok    ${label}`);
    } else {
        fail += 1;
        console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
    }
};

const rejects = async (label, fn, fragment) => {
    try {
        await fn();
        fail += 1;
        console.log(`  FAIL  ${label} — expected a rejection, got success`);
    } catch (error) {
        if (String(error.message).includes(fragment)) {
            pass += 1;
            console.log(`  ok    ${label}`);
        } else {
            fail += 1;
            console.log(`  FAIL  ${label}\n          expected message containing "${fragment}"\n          actual   "${error.message}"`);
        }
    }
};

const cleanup = async () => {
    await FrameStyle.destroy({ where: { name: { [Op.like]: `${PREFIX}%` } }, force: true });
    await TemplateCategory.destroy({ where: { name: { [Op.like]: `${PREFIX}%` } }, force: true });
};

(async () => {
    await cleanup();

    console.log('\ntemplate categories');

    const elegant = await categories.create({ name: `${PREFIX} Elegant` }, null);
    check('slug derived from the name', elegant.slug, `${PREFIX}-elegant`);
    check('active by default', elegant.is_active, 1);

    const dup = await categories.create({ name: `${PREFIX} Elegant` }, null);
    check('duplicate name gets a suffixed slug', dup.slug, `${PREFIX}-elegant-2`);

    await rejects('name is required', () => categories.create({ name: '   ' }, null), 'name is required');

    const renamed = await categories.update(elegant.id, { name: `${PREFIX} Elegant Renamed` }, null);
    check('renaming does NOT re-point the slug', renamed.slug, `${PREFIX}-elegant`);

    const reslugged = await categories.update(elegant.id, { slug: `${PREFIX} Elegant Renamed` }, null);
    check('an explicit slug IS regenerated', reslugged.slug, `${PREFIX}-elegant-renamed`);

    // A soft-deleted slug must be reusable, which is why there is no UNIQUE index.
    const throwaway = await categories.create({ name: `${PREFIX} Recycle` }, null);
    await categories.deleteById(throwaway.id, null);
    const recycled = await categories.create({ name: `${PREFIX} Recycle` }, null);
    check('a soft-deleted slug is reusable', recycled.slug, `${PREFIX}-recycle`);

    console.log('\nframe styles');

    const frame = await frames.create({
        name: `${PREFIX} Royal Elegance Frame`,
        template_category_id: elegant.id,
        file_url: 'https://cdn.example.com/frames/royal.svg',
        file_name: 'royal.svg',
        supported_layouts: ['portrait', 'landscape', 'square'],
    }, null);
    check('category joined onto the row', frame.category.id, elegant.id);
    check('published by default', frame.status, 'published');
    check('layouts stored in full', frame.supported_layouts, ['portrait', 'landscape', 'square']);
    check('label built for the list column', frame.supported_layouts_label, 'Portrait, Landscape, Square');

    await rejects('name is required', () => frames.create({
        name: '', template_category_id: elegant.id, file_url: 'x',
    }, null), 'name is required');

    await rejects('category is required', () => frames.create({
        name: `${PREFIX} No Cat`, file_url: 'x',
    }, null), 'Category is required');

    await rejects('the file is required', () => frames.create({
        name: `${PREFIX} No File`, template_category_id: elegant.id,
    }, null), 'upload the frame');

    await rejects('a category that does not exist is refused', () => frames.create({
        name: `${PREFIX} Bad Cat`, template_category_id: 99999999, file_url: 'x',
    }, null), 'does not exist');

    // Normalisation
    const messy = await frames.create({
        name: `${PREFIX} Messy Layouts`,
        template_category_id: elegant.id,
        file_url: 'https://cdn.example.com/frames/messy.svg',
        // Out of order, duplicated, one bogus value, and a string rather than an array.
        supported_layouts: 'square, PORTRAIT, square, hexagon',
    }, null);
    check('unknown layout dropped, de-duped, fixed order', messy.supported_layouts, ['portrait', 'square']);

    const emptied = await frames.update(messy.id, { supported_layouts: [] }, null);
    check('an empty layout list falls back to all three', emptied.supported_layouts, ['portrait', 'landscape', 'square']);

    const draft = await frames.create({
        name: `${PREFIX} Draft Frame`,
        template_category_id: elegant.id,
        file_url: 'https://cdn.example.com/frames/draft.svg',
        status: 'draft',
        is_active: 0,
    }, null);
    check('draft + inactive are stored independently', [draft.status, draft.is_active], ['draft', 0]);

    const activated = await frames.updateStatus(draft.id, true, null);
    check('activating does NOT publish a draft', [activated.status, activated.is_active], ['draft', 1]);

    // Filters
    const byCategory = await frames.getAll({ template_category_id: elegant.id, limit: 100 });
    check('filter by category returns only that category', byCategory.data.every((f) => f.template_category_id === elegant.id), true);

    const drafts = await frames.getAll({ publish_status: 'draft', limit: 100 });
    check('filter by publish status finds the draft', drafts.data.some((f) => f.id === draft.id), true);

    const portraitOnly = await frames.create({
        name: `${PREFIX} Portrait Only`,
        template_category_id: elegant.id,
        file_url: 'https://cdn.example.com/frames/portrait.svg',
        supported_layouts: ['portrait'],
    }, null);
    const landscape = await frames.getAll({ layout: 'landscape', limit: 100 });
    check('layout filter excludes a portrait-only row', landscape.data.some((f) => f.id === portraitOnly.id), false);
    check('layout filter includes a row that has it', landscape.data.some((f) => f.id === frame.id), true);

    const searched = await frames.getAll({ search: 'Royal Elegance', limit: 100 });
    check('search matches on name', searched.data.some((f) => f.id === frame.id), true);

    const stats = await frames.getStats();
    check('stats count the drafts separately', stats.draft >= 1, true);

    // Deleting a category must NOT take its frames with it.
    const before = await FrameStyle.count({ where: { template_category_id: elegant.id } });
    const result = await categories.deleteById(elegant.id, null);
    check('the delete reports how many frames it orphaned', result.orphaned_frame_styles, before);
    const survivor = await FrameStyle.findByPk(frame.id);
    check('the frame survives its category being deleted', !!survivor, true);

    // A soft delete is an UPDATE, so ON DELETE SET NULL never fires and the
    // reference is KEPT. The read hides it instead — and that is what makes
    // restoring a category non-lossy.
    const orphan = await frames.getById(frame.id);
    check('the reference is kept, not blanked', orphan.template_category_id, elegant.id);
    check('but the deleted category joins as null', orphan.category, null);

    await TemplateCategory.restore({ where: { id: elegant.id } });
    const restored = await frames.getById(frame.id);
    check('restoring the category re-files every frame', restored.category.id, elegant.id);

    await cleanup();

    console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}\n`);
    process.exit(fail ? 1 : 0);
})().catch(async (error) => {
    console.error('\nunhandled:', error);
    await cleanup();
    process.exit(1);
});
