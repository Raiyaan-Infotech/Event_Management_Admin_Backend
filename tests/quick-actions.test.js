/*
 * Home → Quick Actions (2026-10-19), through the service (no server):
 *   · available = the plan's active menus, one per base slug
 *   · no saved list → the default set (only what the plan grants)
 *   · save keeps the order, drops unknown / not-granted / duplicate slugs,
 *     accepts a category-suffixed slug as its base
 *   · empty list allowed (no limit, nothing locked); null → back to default
 * Restores the client's saved value at the end.
 *
 *   node tests/quick-actions.test.js
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { WebsiteClient } = require('../src/models');
const svc = require('../src/services/clientQuickActions.service');

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

(async () => {
    const clients = await WebsiteClient.findAll({
        where: { subscription_plan_id: { [Op.ne]: null } },
        attributes: ['id', 'quick_actions'],
        limit: 20,
    });
    let client = null; let first = null;
    for (const c of clients) {
        // eslint-disable-next-line no-await-in-loop
        const r = await svc.get(c.id);
        if (r.available.length >= 3) { client = c; first = r; break; }
    }
    if (!client) { console.log('SKIP  no client with a plan granting 3+ menus'); process.exit(0); }
    const saved = client.quick_actions;
    console.log(`Client #${client.id} · ${first.available.length} plan menus: ${first.available.map((m) => m.slug).join(', ')}`);

    try {
        await WebsiteClient.update({ quick_actions: null }, { where: { id: client.id } });
        const def = await svc.get(client.id);
        const slugs = def.available.map((m) => m.slug);
        ok('available has one entry per base slug', new Set(slugs).size === slugs.length && slugs.every((s) => !/-\d+$/.test(s)));
        ok('available entries carry name and icon', def.available.every((m) => m.name && 'icon' in m));
        ok('no saved list → default set, all granted', !def.is_custom && def.selected.every((s) => slugs.includes(s)), JSON.stringify(def.selected));
        ok('default keeps its own order', JSON.stringify(def.selected) === JSON.stringify(svc.DEFAULT_SLUGS.filter((s) => slugs.includes(s))));

        const [a, b, c] = slugs;
        const r1 = await svc.save(client.id, [c, `${a}-2`, 'not-a-menu', c, b]);
        ok('save keeps the order, base slug of a suffixed one, drops unknown + duplicate', JSON.stringify(r1.selected) === JSON.stringify([c, a, b]), JSON.stringify(r1.selected));
        ok('…and is marked customised', r1.is_custom === true);
        ok('read back the same', JSON.stringify((await svc.get(client.id)).selected) === JSON.stringify([c, a, b]));

        const r2 = await svc.save(client.id, []);
        ok('empty list allowed (nothing locked)', r2.selected.length === 0 && r2.is_custom);

        const r3 = await svc.save(client.id, slugs);
        ok('every plan menu allowed (no limit)', r3.selected.length === slugs.length);

        const r4 = await svc.save(client.id, null);
        ok('null → back to the default set', !r4.is_custom && JSON.stringify(r4.selected) === JSON.stringify(def.selected));

        try { await svc.save(client.id, 'gallery'); ok('a non-list is refused', false); }
        catch (e) { ok('a non-list is refused', e.statusCode === 400); }

        // A stored slug the plan no longer grants is cut on read.
        await WebsiteClient.update({ quick_actions: ['zz-gone', a] }, { where: { id: client.id } });
        ok('a slug the plan no longer grants is dropped on read', JSON.stringify((await svc.get(client.id)).selected) === JSON.stringify([a]));
    } finally {
        await WebsiteClient.update({ quick_actions: saved ?? null }, { where: { id: client.id } });
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
