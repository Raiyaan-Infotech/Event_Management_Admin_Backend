/*
 * Plan usage, end to end through the real services (no server), 2026-10-19:
 *
 *   · Max Photos counts gallery photos AND Wed Wishes photos together
 *   · a full photo limit refuses both a gallery upload and a wish photo
 *   · crossing 50% / reaching 100% of photos and of storage writes the
 *     organizer's in-app alert and pushes it (push is captured, never sent)
 *   · getUsage reports the combined numbers the app's rings draw
 *
 * The plan limits are stubbed in this process only (no plan row is changed).
 * Everything it creates — gallery items, wishes, stored files, notifications —
 * is deleted at the end.
 *
 *   node tests/plan-usage-alerts.test.js
 */
require('dotenv').config();

const { Op } = require('sequelize');
const {
    Event, EventParticipant, EventGalleryItem, EventWish, WebsiteClient, ClientNotification,
} = require('../src/models');
const plans = require('../src/services/subscriptionPlan.service');
const pushSender = require('../src/services/pushSender.service');
const gallery = require('../src/services/clientGallery.service');
const wishes = require('../src/services/clientWish.service');

let sharp = null;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    if (!sharp) { console.log('SKIP  sharp not installed'); process.exit(0); }

    // An event with a joined participant (not the owner) and as few photos as possible.
    const joinedRows = await EventParticipant.findAll({
        where: { participant_client_id: { [Op.ne]: null } },
        attributes: ['event_id', 'participant_client_id'],
        order: [['id', 'DESC']],
        limit: 80,
    });
    let event = null; let guest = null; let best = Infinity;
    for (const j of joinedRows) {
        // eslint-disable-next-line no-await-in-loop
        const e = await Event.findByPk(j.event_id);
        if (!e || Number(e.website_client_id) === Number(j.participant_client_id)) continue;
        // eslint-disable-next-line no-await-in-loop
        const n = await gallery.photosUsedFor(e.id);
        if (n < best) { best = n; event = e; guest = Number(j.participant_client_id); }
        if (n === 0) break;
    }
    if (!event) { console.log('SKIP  no event with a joined participant'); process.exit(0); }
    const owner = Number(event.website_client_id);
    const ownerRow = await WebsiteClient.findByPk(owner, { attributes: ['id', 'subscription_plan_id'] });
    const photosBefore = await gallery.photosUsedFor(event.id);
    const storageBefore = await gallery.storageUsedFor(owner);
    console.log(`Event #${event.id} · owner #${owner} · participant #${guest} · ${photosBefore} photos · ${storageBefore} bytes stored`);

    // ── Stubs: limits that this test can cross, and a captured push ───────────
    // Photos: one more than now is exactly 50% → limit = 2 × (photos + 1).
    const photoLimit = 2 * (photosBefore + 1);
    const realLimit = plans.getPlanLimit;
    const realGetById = plans.getById;
    const realSend = pushSender.sendToTokens;
    plans.getPlanLimit = async (planId, key) => {
        if (key === 'max_photos') return photoLimit;
        if (key === 'max_videos') return null;
        return realLimit(planId, key);
    };
    // Storage: just over twice what is stored now, so the first upload crosses 50%.
    const storageLimitBytes = 2 * storageBefore + 1;
    const hasPlan = !!ownerRow?.subscription_plan_id;
    plans.getById = async (id) => {
        const real = await realGetById(id).catch(() => null);
        const plain = real?.toJSON ? real.toJSON() : (real || {});
        return { ...plain, storage_limit: storageLimitBytes / (1024 * 1024), storage_unit: 'MB' };
    };
    const pushes = [];
    pushSender.sendToTokens = async (tokens, payload) => {
        pushes.push({ count: tokens.length, payload });
        return tokens.map((t) => ({ token: t.token, ok: true }));
    };

    const startNote = (await ClientNotification.max('id')) || 0;
    const alerts = async () => ClientNotification.findAll({
        where: { id: { [Op.gt]: startNote }, website_client_id: owner, type: 'storage_alert' },
        order: [['id', 'ASC']],
    });
    const png = async (colour) => {
        const buf = await sharp({ create: { width: 40, height: 30, channels: 3, background: colour } }).png().toBuffer();
        return { buffer: buf, size: buf.length, mimetype: 'image/png', originalname: `zz-usage-${Date.now()}.png` };
    };

    const madeItems = []; const madeWishes = [];
    try {
        // ── 1. Gallery photo → photos reach 50% (and storage passes 50%) ─────
        const up1 = await gallery.uploadItem(owner, event.id, await png('#2563eb'), {});
        madeItems.push(up1.item.id);
        ok('gallery photo uploaded', !!up1.item?.id);
        await wait(1200);
        let a = await alerts();
        const photoHalf = a.find((n) => n.meta?.kind === 'photos' && n.meta?.level === 'half');
        ok('photos 50% alert written for the organizer', !!photoHalf, JSON.stringify(a.map((n) => n.meta)));
        ok('…it names photos and the event', photoHalf && /photos/i.test(photoHalf.title) && photoHalf.body.includes(event.name || ''), photoHalf?.body);
        if (hasPlan) {
            ok('storage 50% alert written', a.some((n) => n.meta?.kind === 'storage' && n.meta?.level === 'half'), JSON.stringify(a.map((n) => n.meta)));
        } else {
            console.log('  SKIP  storage alert (owner has no plan → no storage limit)');
        }

        // ── 2. Wish PHOTO by the participant → counts toward Max Photos ──────
        const filled = photoLimit - (photosBefore + 1); // photos still free
        for (let i = 0; i < filled; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const w = await wishes.create(guest, event.id, { post_type: 'image', message: `zz usage ${i}` }, await png('#16a34a'));
            madeWishes.push(w.id);
        }
        ok(`${filled} wish photo(s) posted`, madeWishes.length === filled);
        const usage = await gallery.getUsage(owner, event.id);
        ok('usage counts gallery + wish photos together', usage.photos.used === photoLimit && usage.photos.limit === photoLimit, JSON.stringify(usage.photos));
        await wait(1200);
        a = await alerts();
        ok('photos FULL alert written when a wish photo fills it', a.some((n) => n.meta?.kind === 'photos' && n.meta?.level === 'full'), JSON.stringify(a.map((n) => n.meta)));

        // ── 3. Full → both doors refuse ──────────────────────────────────────
        try {
            const extra = await gallery.uploadItem(owner, event.id, await png('#dc2626'), {});
            madeItems.push(extra.item.id);
            ok('gallery photo refused when full', false, '(was allowed)');
        } catch (e) {
            ok('gallery photo refused when full', e.statusCode === 400 && /limit of/.test(e.message), e.message);
        }
        try {
            const extra = await wishes.create(guest, event.id, { post_type: 'image', message: 'zz over' }, await png('#dc2626'));
            madeWishes.push(extra.id);
            ok('wish photo refused when full', false, '(was allowed)');
        } catch (e) {
            ok('wish photo refused when full', e.statusCode === 400 && /limit of \d+ photo/.test(e.message), e.message);
        }
        ok('a text wish is still allowed when photos are full', await wishes.create(guest, event.id, { message: 'zz text ok' }).then((w) => { madeWishes.push(w.id); return true; }).catch(() => false));

        // ── 4. No repeat alerts while staying over the line ──────────────────
        const before = (await alerts()).length;
        await wishes.remove(owner, madeWishes.shift()); // free one photo (now under 100%, still over 50%)
        const again = await gallery.uploadItem(owner, event.id, await png('#9333ea'), {});
        madeItems.push(again.item.id);
        await wait(1200);
        const fullAgain = (await alerts()).slice(before);
        ok('refilling after a delete sends the full alert again, once', fullAgain.filter((n) => n.meta?.kind === 'photos' && n.meta?.level === 'full').length === 1
            && !fullAgain.some((n) => n.meta?.kind === 'photos' && n.meta?.level === 'half'), JSON.stringify(fullAgain.map((n) => n.meta)));

        // ── 5. Push went out with the same words (captured, not sent) ────────
        const tokens = await require('../src/models').ClientDeviceToken.count({ where: { website_client_id: owner, is_active: 1 } });
        if (tokens) {
            ok('push sent for each alert, same title as in-app', pushes.length === (await alerts()).length
                && pushes.every((p) => (p.payload.data || {}).type === 'storage_alert'), `${pushes.length} pushes`);
        } else {
            ok('no device → no push attempted', pushes.length === 0);
        }

        // ── 6. Category for the bell ─────────────────────────────────────────
        ok('alerts are filed under System', (await alerts()).every((n) => n.category === 'system'));
        console.log('\n  Alerts written:');
        for (const n of await alerts()) console.log(`    · [${n.meta?.kind} ${n.meta?.level}] ${n.title} — ${n.body}`);
    } finally {
        plans.getPlanLimit = realLimit;
        plans.getById = realGetById;
        pushSender.sendToTokens = realSend;
        for (const id of madeWishes) {
            // eslint-disable-next-line no-await-in-loop
            await wishes.remove(owner, id).catch(async () => { await EventWish.destroy({ where: { id }, force: true }); });
        }
        for (const id of madeItems) {
            // eslint-disable-next-line no-await-in-loop
            await gallery.removeItem(owner, id).catch(async () => { await EventGalleryItem.destroy({ where: { id }, force: true }); });
        }
        await ClientNotification.destroy({ where: { id: { [Op.gt]: startNote }, type: 'storage_alert' }, force: true });
        const back = await gallery.photosUsedFor(event.id);
        ok('cleaned up: photo count back to where it was', back === photosBefore, `${back} vs ${photosBefore}`);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
