/**
 * Storage 50% / 100% alert (notificationTrigger.checkStorageCrossing).
 * Local DB, no server, no real push. Writes client_notifications rows for one
 * existing client and deletes them again.
 *
 *   node tests/storage-alert.test.js
 */
require('dotenv').config();
const { WebsiteClient, ClientNotification, NotificationTemplate } = require('../src/models');
const trigger = require('../src/services/notificationTrigger.service');

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
    if (cond) { pass += 1; console.log(`  PASS  ${label}`); } else { fail += 1; console.log(`  FAIL  ${label}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

(async () => {
    const client = await WebsiteClient.findOne({ attributes: ['id'] });
    if (!client) { console.log('no client to test with'); process.exit(1); }
    const where = { website_client_id: client.id, type: 'storage_alert' };
    const count = () => ClientNotification.count({ where });
    const before = await count();
    const limit = 100 * MB;

    // Below 50% -> nothing.
    trigger.checkStorageCrossing(client.id, 10 * MB, 10 * MB, limit);
    await wait(600);
    ok((await count()) === before, 'staying under 50% sends nothing');

    // Crossing 50% -> one "half" alert.
    trigger.checkStorageCrossing(client.id, 45 * MB, 10 * MB, limit);
    await wait(900);
    ok((await count()) === before + 1, 'crossing 50% sends one alert');
    const half = await ClientNotification.findOne({ where, order: [['id', 'DESC']] });
    ok(half && /55/.test(half.title + half.body) && /100 MB/.test(half.body), 'the text names the percentage and the plan size');
    ok(half && half.category === 'system', 'filed under system');

    // Already past 50%, still under 100% -> nothing new.
    trigger.checkStorageCrossing(client.id, 60 * MB, 10 * MB, limit);
    await wait(600);
    ok((await count()) === before + 1, 'already over 50% sends nothing more');

    // Crossing 75% -> one "75%" alert, then nothing more under 100%.
    trigger.checkStorageCrossing(client.id, 70 * MB, 10 * MB, limit);
    await wait(900);
    const q = await ClientNotification.findOne({ where, order: [['id', 'DESC']] });
    ok((await count()) === before + 2 && q.meta?.level === 'three_quarter' && /80%/.test(q.title), 'crossing 75% sends one 75% alert (says 80%)', q?.title);
    trigger.checkStorageCrossing(client.id, 80 * MB, 10 * MB, limit);
    await wait(500);
    ok((await count()) === before + 2, 'between 75% and 100% sends nothing more');
    // Jumping 40% -> 80% sends only the 75% one, not the 50% one too.
    const mid = await count();
    trigger.checkStorageCrossing(client.id, 40 * MB, 40 * MB, limit);
    await wait(900);
    const j = await ClientNotification.findOne({ where, order: [['id', 'DESC']] });
    ok((await count()) === mid + 1 && j.meta?.level === 'three_quarter', 'jumping 40% → 80% sends only the 75% alert');
    await ClientNotification.destroy({ where: { id: j.id }, force: true });
    await ClientNotification.destroy({ where: { id: q.id }, force: true });

    // Reaching 100% -> one "full" alert.
    trigger.checkStorageCrossing(client.id, 95 * MB, 5 * MB, limit);
    await wait(900);
    ok((await count()) === before + 2, 'reaching 100% sends one more alert');
    const full = await ClientNotification.findOne({ where, order: [['id', 'DESC']] });
    ok(full && /full/i.test(full.title), 'the full alert says it is full');

    // Jumping straight over both -> only the full one.
    trigger.checkStorageCrossing(client.id, 10 * MB, 95 * MB, limit);
    await wait(900);
    ok((await count()) === before + 3, 'jumping past 50% and 100% together sends a single alert');

    // No limit / no client -> nothing, no throw.
    trigger.checkStorageCrossing(client.id, 1, 1, null);
    trigger.checkStorageCrossing(null, 1, 1, limit);
    await wait(300);
    ok((await count()) === before + 3, 'no plan limit sends nothing');

    // Photo / video limits (counts, per event) alert the same way.
    const n0 = await count();
    trigger.checkUsageCrossing(client.id, 'photos', 1, 1, 5, { eventName: 'Test Event' });
    await wait(300);
    ok((await count()) === n0, 'photos 2 of 5 (40%) sends nothing');
    trigger.checkUsageCrossing(client.id, 'photos', 2, 1, 5, { eventName: 'Test Event' });
    await wait(900);
    ok((await count()) === n0 + 1, 'photos reaching 3 of 5 sends the 50% alert');
    const p = await ClientNotification.findOne({ where, order: [['id', 'DESC']] });
    ok(p && /photos/i.test(p.title) && /Test Event/.test(p.body) && /3 of 5/.test(p.body), 'it names photos, the event and the count');
    trigger.checkUsageCrossing(client.id, 'videos', 0, 1, 1, { eventName: 'Test Event' });
    await wait(900);
    const v = await ClientNotification.findOne({ where, order: [['id', 'DESC']] });
    ok((await count()) === n0 + 2 && /videos/i.test(v.title) && /full/i.test(v.title), 'videos 1 of 1 sends the full alert');

    // An inactive template silences it.
    const tpl = await NotificationTemplate.findOne({ where: { trigger_key: 'storage_half_full' } });
    if (tpl) {
        const was = tpl.is_active;
        await NotificationTemplate.update({ is_active: 0 }, { where: { id: tpl.id } });
        const r = await trigger.triggerStorageAlert({ clientId: client.id, level: 'half', usedBytes: 60 * MB, limitBytes: limit });
        ok(r.reason === 'template_inactive', 'an inactive template sends nothing');
        await NotificationTemplate.update({ is_active: was }, { where: { id: tpl.id } });
    } else {
        console.log('  (no storage_half_full template locally - inactive case skipped)');
    }

    await ClientNotification.destroy({ where, force: true });
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
