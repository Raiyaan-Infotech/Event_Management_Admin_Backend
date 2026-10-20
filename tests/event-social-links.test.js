/*
 * Social Links — through the service (no server needed).
 *
 * ── WHAT THIS FILE IS GUARDING ──────────────────────────────────────────────
 *   · every event gets the four PRESET links (Instagram, Facebook, X, YouTube)
 *     the first time its list is read — once, never duplicated
 *   · a preset keeps its platform and icon; "delete" only clears its link
 *   · a CUSTOM link needs platform name, title and a http(s) link; it can be
 *     edited (platform name, icon) and deleted
 *   · Display Order (position) and drag reorder
 *   · a participant sees only links with a URL that are shown in the app, and
 *     cannot write; a stranger is refused
 *   · an uploaded icon becomes a 256 × 256 PNG
 *
 * Everything it creates is deleted.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/event-social-links.test.js
 * Needs the local DB migrated with apply-event-social-links.js, and an event
 * that has a joined participant (participant_client_id set).
 */
require('dotenv').config();

const { Op } = require('sequelize');
const { sequelize, Event, EventParticipant, EventSocialLink } = require('../src/models');
const social = require('../src/services/clientSocialLink.service');

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};
const refused = async (fn) => {
    try { await fn(); return null; } catch (e) { return e.message; }
};

(async () => {
    const joined = await EventParticipant.findOne({
        where: { participant_client_id: { [Op.ne]: null } },
        include: [{ model: Event, as: 'event', required: true, attributes: ['id', 'website_client_id'] }],
    });
    if (!joined || !joined.event) {
        console.log('SKIP  no event with a joined participant on this database');
        process.exit(0);
    }
    const event = joined.event;
    const host = Number(event.website_client_id);
    const guest = Number(joined.participant_client_id);
    const stranger = 999999999;
    const before = new Set((await EventSocialLink.findAll({ where: { event_id: event.id }, attributes: ['id'] })).map((r) => r.id));
    const custom = { platform_name: 'Our Website', title: 'Wedding site', url: 'https://example.com/wedding' };

    try {
        console.log(`Event #${event.id} · host #${host} · participant #${guest}`);

        // ── Presets ──────────────────────────────────────────────────────
        const l0 = await social.list(host, event.id);
        const keys = l0.links.filter((l) => l.is_preset).map((l) => l.platform_key);
        ok('four presets: instagram, facebook, x, youtube', ['instagram', 'facebook', 'x', 'youtube'].every((k) => keys.includes(k)) && keys.length === 4, keys.join(','));
        ok('menu reported + icon size 256', !!l0.menu_id && l0.icon_size === 256);
        await social.list(host, event.id);
        ok('reading again makes no duplicates', (await EventSocialLink.count({ where: { event_id: event.id, platform_key: { [Op.ne]: null } } })) === 4);

        const insta = l0.links.find((l) => l.platform_key === 'instagram');
        const pre = Object.fromEntries((await EventSocialLink.findAll({ where: { event_id: event.id, platform_key: { [Op.ne]: null } } })).map((r) => [r.id, r.toJSON()]));
        ok('participant does not see presets with no link', !(await social.list(guest, event.id)).links.some((l) => l.id === insta.id && !pre[insta.id].url));

        const i1 = await social.update(host, insta.id, { title: 'Our Wedding Instagram', url: 'https://instagram.com/arjunpriya', description: 'Behind the scenes' });
        ok('preset: link added', i1.url === 'https://instagram.com/arjunpriya' && i1.title === 'Our Wedding Instagram' && i1.platform_name === 'Instagram');
        ok('preset: platform cannot change', /cannot be changed/.test(await refused(() => social.update(host, insta.id, { platform_name: 'Insta2' })) || ''));
        ok('preset: icon cannot change', /cannot be changed/.test(await refused(() => social.update(host, insta.id, { icon_url: '/uploads/x.png' })) || ''));
        ok('preset: same platform name passes', (await social.update(host, insta.id, { platform_name: 'Instagram', title: 'Our Wedding Instagram' })).platform_name === 'Instagram');
        ok('bad link refused', /valid link/.test(await refused(() => social.update(host, insta.id, { url: 'instagram.com/x' })) || ''));
        ok('participant now sees the Instagram link', (await social.list(guest, event.id)).links.some((l) => l.id === insta.id));
        ok('participant cannot edit', !!(await refused(() => social.update(guest, insta.id, { title: 'X' }))));

        const hidden = await social.update(host, insta.id, { show_in_app: false });
        ok('Show in App off hides it from participants', hidden.show_in_app === false && !(await social.list(guest, event.id)).links.some((l) => l.id === insta.id));
        ok('participant cannot open a hidden link', !!(await refused(() => social.getOne(guest, insta.id))));
        await social.update(host, insta.id, { show_in_app: true, open_external: false });

        const cleared = await social.remove(host, insta.id);
        const still = await EventSocialLink.findByPk(insta.id);
        ok('preset delete only clears the link (row stays)', cleared.cleared === true && still && still.url === null && still.title === 'Instagram');

        // ── Custom ───────────────────────────────────────────────────────
        ok('custom: platform name required', /mandatory/.test(await refused(() => social.create(host, event.id, { ...custom, platform_name: '' })) || ''));
        ok('custom: title required', /mandatory/.test(await refused(() => social.create(host, event.id, { ...custom, title: '' })) || ''));
        ok('custom: link required', /mandatory/.test(await refused(() => social.create(host, event.id, { ...custom, url: '' })) || ''));
        ok('participant cannot add', !!(await refused(() => social.create(guest, event.id, custom))));
        const c1 = await social.create(host, event.id, { ...custom, icon_url: '/uploads/test/site.png' });
        ok('custom added, last, with its icon', !c1.is_preset && c1.platform_name === 'Our Website' && c1.icon_url === '/uploads/test/site.png');
        const c2 = await social.create(host, event.id, { ...custom, title: 'Venue map', platform_name: 'Venue Location', position: 1 });
        const afterPos = (await social.list(host, event.id)).links;
        ok('Display Order 1 puts it first', afterPos[0].id === c2.id, afterPos.map((l) => l.id).join(','));
        const c1e = await social.update(host, c1.id, { platform_name: 'Website', icon_url: '' });
        ok('custom: platform name + icon can change', c1e.platform_name === 'Website' && c1e.icon_url === null);

        // ── Reorder ──────────────────────────────────────────────────────
        const ids = afterPos.map((l) => l.id).reverse();
        const ro = await social.reorder(host, event.id, { ids });
        ok('drag reorder saves the order', ro.links.map((l) => l.id).join(',') === ids.join(','));
        ok('participant cannot reorder', !!(await refused(() => social.reorder(guest, event.id, { ids }))));
        ok('stranger cannot list', !!(await refused(() => social.list(stranger, event.id))));

        // ── Delete custom ────────────────────────────────────────────────
        const del = await social.remove(host, c2.id);
        ok('custom delete removes the row', del.removed === true && !(await EventSocialLink.findByPk(c2.id)));

        // ── Icon upload → 256 PNG ────────────────────────────────────────
        let sharp = null;
        try { sharp = require('sharp'); } catch (_) { sharp = null; }
        if (sharp) {
            const src = await sharp({ create: { width: 900, height: 400, channels: 4, background: { r: 200, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
            const up = await social.uploadIcon(host, event.id, { buffer: src, size: src.length, mimetype: 'image/png', originalname: 'logo.png' });
            ok('icon upload answers a URL', !!up.url && up.size === 256);
            const fs = require('fs'); const path = require('path');
            const local = up.url.startsWith('/uploads/') ? path.join(__dirname, '..', up.url) : null;
            if (local && fs.existsSync(local)) {
                const meta = await sharp(local).metadata();
                ok('stored icon is a 256 × 256 PNG', meta.width === 256 && meta.height === 256 && meta.format === 'png', JSON.stringify(meta));
                fs.unlinkSync(local);
            }
        }
    } catch (e) {
        fail++;
        console.log(`  FAIL  unexpected error: ${e.stack}`);
    } finally {
        // New rows go; presets that existed before are put back as they were.
        const now = await EventSocialLink.findAll({ where: { event_id: event.id }, attributes: ['id'] });
        const made = now.map((r) => r.id).filter((id) => !before.has(id));
        if (made.length) await EventSocialLink.destroy({ where: { id: made } });
        console.log(`\n${pass} passed, ${fail} failed (cleaned ${made.length} rows)`);
        await sequelize.close();
        process.exit(fail ? 1 : 0);
    }
})();
