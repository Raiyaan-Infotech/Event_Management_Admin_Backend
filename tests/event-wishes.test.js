/*
 * Wed Wishes (2026-10-16) — the rules, through the service (no server).
 *
 *   · posts: text / image / video, audience groom / bride / both, likes
 *   · a participant's post is visible at once, named from their participant row
 *   · the organizer posts as the organizer (signed with the event's organizer name)
 *   · participants never see a hidden post (except their own) or others' mobiles
 *   · a participant edits / deletes only their own
 *   · block = Wishes only, per event: no new post, edit or like; delete own OK
 *   · organizer counts: all / visible / hidden / blocked / blocked_users
 *   · "Max Videos" and "Max Storage" count gallery + wishes together
 *   · settings: allow_new / allow_photo / details_screen, trimmed fields
 *   · text is cut by characters — an emoji at the limit is never split
 *
 * Everything it creates (rows and stored files) is deleted.
 *   node tests/event-wishes.test.js        (needs the local DB with a joined participant)
 */
require('dotenv').config();

const { Op } = require('sequelize');
const { Event, EventParticipant, EventWish, EventWishBlock, EventWishLike } = require('../src/models');
const wishes = require('../src/services/clientWish.service');
const gallery = require('../src/services/clientGallery.service');

let sharp = null;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};
const refused = async (label, fn, status) => {
    try { await fn(); ok(label, false, '(was allowed)'); }
    catch (e) { ok(label, !status || e.statusCode === status, `(got ${e.statusCode} ${e.message})`); }
};

(async () => {
    // A participant who joined an event they do not own.
    const candidates = await EventParticipant.findAll({
        where: { participant_client_id: { [Op.ne]: null } },
        attributes: ['id', 'event_id', 'participant_client_id', 'name'],
        order: [['id', 'DESC']],
        limit: 50,
    });
    let joined = null; let event = null;
    for (const c of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const e = await Event.findByPk(c.event_id);
        if (e && Number(e.website_client_id) !== Number(c.participant_client_id)) { joined = c; event = e; break; }
    }
    if (!joined) { console.log('SKIP  no joined participant on this database'); process.exit(0); }
    const owner = Number(event.website_client_id);
    const guest = Number(joined.participant_client_id);
    console.log(`Event #${event.id} · owner #${owner} · participant #${guest} (${joined.name})`);

    const made = [];
    const savedSettings = event.wish_settings;
    try {
        // ── Participant posts ─────────────────────────────────────────────
        const mine = await wishes.create(guest, event.id, { message: '  Congratulations!  ', audience: 'bride' });
        made.push(mine.id);
        ok('text post saved, trimmed', mine.message === 'Congratulations!' && mine.post_type === 'text');
        ok('audience kept', mine.audience === 'bride');
        ok('visible at once (no approval)', mine.status === 'visible' && !mine.is_hidden);
        ok('named from the participant row', mine.guest_name === String(joined.name).trim().slice(0, 150), mine.guest_name);
        ok('marked as mine, editable', mine.is_mine && mine.can_edit && mine.can_delete);
        await refused('text post: empty message refused', () => wishes.create(guest, event.id, { message: '  ' }), 400);
        await refused('image post without a file refused', () => wishes.create(guest, event.id, { post_type: 'image', message: 'x' }), 400);
        const bad = await wishes.create(guest, event.id, { message: 'a', audience: 'everyone' });
        made.push(bad.id);
        ok('unknown audience falls back to both', bad.audience === 'both');

        // ── Characters, not UTF-16 units ──────────────────────────────────
        const long = await wishes.create(guest, event.id, { message: `${'a'.repeat(499)}😀😀` });
        made.push(long.id);
        ok('cut at 500 characters, emoji kept whole', Array.from(long.message).length === 500 && long.message.endsWith('😀'));
        const tamil = await wishes.create(guest, event.id, { message: 'வாழ்த்துக்கள் 💐 शुभकामनाएँ' });
        made.push(tamil.id);
        ok('Tamil / Hindi / emoji saved as typed', (await EventWish.findByPk(tamil.id)).message === 'வாழ்த்துக்கள் 💐 शुभकामनाएँ');

        // ── Organizer posts ───────────────────────────────────────────────
        const theirs = await wishes.create(owner, event.id, { message: 'Welcome all', audience: 'both' });
        made.push(theirs.id);
        ok('organizer post: signed, no mobile', !!theirs.guest_name && theirs.added_by_organizer && theirs.mobile === null);
        ok('organizer post visible', theirs.status === 'visible');

        // ── Image post (real file through storage) ────────────────────────
        if (sharp) {
            const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#e11d48' } }).png().toBuffer();
            const file = { buffer: png, size: png.length, mimetype: 'image/png', originalname: 'zz-wish.png' };
            const img = await wishes.create(guest, event.id, { post_type: 'image', message: 'With photo' }, file);
            made.push(img.id);
            ok('image post stored', img.post_type === 'image' && !!img.photo);
            ok('...with a thumbnail', !!img.thumbnail_url);
            const row = await EventWish.findByPk(img.id);
            ok('...bytes counted on the row', Number(row.size_bytes) > 0);
            const used = await gallery.storageUsedFor(owner);
            ok('storage includes wish bytes', used >= Number(row.size_bytes));
            const turned = await wishes.update(guest, img.id, { post_type: 'text', message: 'Now text' });
            ok('back to text drops the media', turned.post_type === 'text' && turned.photo === null && turned.thumbnail_url === null);
            ok('...and its bytes', Number((await EventWish.findByPk(img.id)).size_bytes) === 0);
        } else {
            console.log('  SKIP  image post (sharp not installed)');
        }

        // ── Max Videos counts gallery + wishes ────────────────────────────
        const beforeVideos = await gallery.videosUsedFor(event.id);
        const fakeVideo = await EventWish.create({
            event_id: event.id, website_client_id: owner, author_client_id: null, guest_name: 'ZzVideo',
            message: '', post_type: 'video', video_url: null, size_bytes: 0,
        });
        made.push(fakeVideo.id);
        ok('a wish video counts in Max Videos', (await gallery.videosUsedFor(event.id)) === beforeVideos + 1);

        // ── Likes ─────────────────────────────────────────────────────────
        let liked = await wishes.setLiked(guest, theirs.id, true);
        ok('participant likes', liked.like_count === 1 && liked.liked_by_me);
        liked = await wishes.setLiked(guest, theirs.id, true);
        ok('liking twice counts once', liked.like_count === 1);
        liked = await wishes.setLiked(owner, theirs.id, true);
        ok('organizer likes too', liked.like_count === 2);
        liked = await wishes.setLiked(guest, theirs.id, false);
        ok('unlike', liked.like_count === 1 && !liked.liked_by_me);

        // ── What each side sees ───────────────────────────────────────────
        await wishes.update(owner, theirs.id, { show_in_app: false });
        let g = await wishes.list(guest, event.id);
        ok('participant does not see a hidden post', !g.wishes.some((w) => w.id === theirs.id));
        ok('participant sees own post', g.wishes.some((w) => w.id === mine.id));
        ok('participant: no counts, cannot manage', !g.counts && g.can_manage === false && g.is_blocked === false);
        await refused('participant cannot read a hidden post by id', () => wishes.getOne(guest, theirs.id), 404);
        await refused('participant cannot like a hidden post', () => wishes.setLiked(guest, theirs.id, true), 404);
        let o = await wishes.list(owner, event.id);
        ok('organizer sees both', [mine.id, theirs.id].every((id) => o.wishes.some((w) => w.id === id)));
        ok('organizer counts add up', o.counts.all === o.counts.visible + o.counts.hidden + o.counts.blocked);
        await wishes.update(owner, theirs.id, { show_in_app: true });
        g = await wishes.list(guest, event.id);
        ok('shown again: participant sees it', g.wishes.some((w) => w.id === theirs.id));
        ok('participant never gets participant_id', g.wishes.every((w) => w.participant_id === null));
        o = await wishes.list(owner, event.id);
        ok('organizer gets the writer participant_id', o.wishes.find((w) => w.id === mine.id).participant_id === Number(joined.id));

        // ── Edit rights ───────────────────────────────────────────────────
        const edited = await wishes.update(guest, mine.id, { message: 'Edited by me', audience: 'groom', show_in_app: false });
        ok('participant edits own message + audience', edited.message === 'Edited by me' && edited.audience === 'groom');
        ok('...cannot hide it', edited.status === 'visible');
        await refused('participant cannot edit the organizer post', () => wishes.update(guest, theirs.id, { message: 'x' }), 403);
        await refused('participant cannot delete the organizer post', () => wishes.remove(guest, theirs.id), 403);

        // ── Block ─────────────────────────────────────────────────────────
        await refused('participant cannot block', () => wishes.setBlocked(guest, mine.id, true), 403);
        await refused('organizer post: nobody to block', () => wishes.setBlocked(owner, theirs.id, true), 400);
        const blocked = await wishes.setBlocked(owner, mine.id, true);
        ok('blocked: status blocked for the organizer', blocked.status === 'blocked' && blocked.author_blocked);
        await wishes.setBlocked(owner, mine.id, true);
        ok('blocking twice keeps one row', (await EventWishBlock.count({ where: { event_id: event.id, author_client_id: guest } })) === 1);
        o = await wishes.list(owner, event.id);
        ok('Blocked Users tile = 1', o.counts.blocked_users === 1);
        g = await wishes.list(guest, event.id);
        ok('participant told they are blocked', g.is_blocked === true && g.can_write === false);
        ok('their existing post still shows', g.wishes.some((w) => w.id === mine.id && w.status === 'visible'));
        await refused('blocked: new post refused', () => wishes.create(guest, event.id, { message: 'again' }), 403);
        await refused('blocked: edit refused', () => wishes.update(guest, mine.id, { message: 'again' }), 403);
        await refused('blocked: like refused', () => wishes.setLiked(guest, theirs.id, true), 403);
        await wishes.setBlocked(owner, mine.id, false);
        const again = await wishes.create(guest, event.id, { message: 'After unblock' });
        made.push(again.id);
        ok('unblocked: can post again', again.status === 'visible');

        // ── Settings ──────────────────────────────────────────────────────
        const d = await wishes.getSettings(guest, event.id);
        ok('settings default: all on', Object.values(d.settings).every((v) => v === true));
        await refused('participant cannot change settings', () => wishes.updateSettings(guest, event.id, { allow_new: false }), 403);
        await EventWish.update({ photo: '/uploads/test/o.jpg', post_type: 'image' }, { where: { id: theirs.id } });
        const s = await wishes.updateSettings(owner, event.id, {
            profile_photo: false, wish_photo: false, time: false, name: false, details_screen: false,
        });
        ok('name stays on', s.settings.name === true && s.settings.time === false);
        g = await wishes.list(guest, event.id);
        const seen = g.wishes.find((w) => w.id === theirs.id);
        ok('others: media / time trimmed', seen && seen.photo === null && seen.created_at === null);
        ok('writer still sees own post whole', g.wishes.find((w) => w.id === mine.id).created_at !== null);
        o = await wishes.list(owner, event.id);
        ok('organizer view never trimmed', o.wishes.find((w) => w.id === theirs.id).photo === '/uploads/test/o.jpg');
        await refused('details off: cannot open another post', () => wishes.getOne(guest, theirs.id), 403);
        ok('details off: own post still opens', (await wishes.getOne(guest, again.id)).id === again.id);
        await wishes.updateSettings(owner, event.id, { allow_photo: false });
        await refused('media off: post with a file refused', () => wishes.create(guest, event.id, { post_type: 'image' }, { buffer: Buffer.from('x'), mimetype: 'image/png' }), 400);
        await wishes.updateSettings(owner, event.id, { allow_new: false });
        g = await wishes.list(guest, event.id);
        ok('closed: can_write false', g.can_write === false);
        ok('closed: organizer can still post', (await wishes.list(owner, event.id)).can_write === true);
        await refused('closed: new post refused', () => wishes.create(guest, event.id, { message: 'closed' }), 403);
        await Event.update({ wish_settings: savedSettings ?? null }, { where: { id: event.id } });
        // The fake photo above is not a real file — clear it so delete has nothing to remove.
        await EventWish.update({ photo: null, post_type: 'text' }, { where: { id: theirs.id } });

        // ── Delete ────────────────────────────────────────────────────────
        await wishes.remove(guest, again.id);
        ok('participant deletes own', !(await EventWish.findByPk(again.id)));
        await wishes.remove(owner, theirs.id);
        ok('organizer deletes; its likes go too', !(await EventWish.findByPk(theirs.id))
            && (await EventWishLike.count({ where: { wish_id: theirs.id } })) === 0);
    } catch (e) {
        fail++; console.log('  FAIL  unexpected:', e.message);
    } finally {
        const left = await EventWish.findAll({ where: { id: made } });
        for (const w of left) {
            // eslint-disable-next-line no-await-in-loop
            await wishes.remove(owner, w.id).catch(() => w.destroy());
        }
        await EventWishBlock.destroy({ where: { event_id: event.id, author_client_id: guest } });
        await Event.update({ wish_settings: savedSettings ?? null }, { where: { id: event.id } });
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
