/*
 * Event Wishes (2026-10-16) — the rules, through the service (no server).
 *
 *   · a participant's wish is visible at once, named from their participant row
 *   · the organizer adds on someone's behalf; Show in App off = hidden
 *   · participants never see a hidden wish (except their own) or others' mobiles
 *   · a participant edits / deletes only their own
 *   · block = Wishes only, per event: no new wish, no edit; delete own still OK;
 *     an organizer-added wish has nobody to block
 *   · organizer counts: all / visible / hidden / blocked
 *
 * Everything it creates is deleted.
 *   node tests/event-wishes.test.js        (needs the local DB with a joined participant)
 */
require('dotenv').config();

const { Op } = require('sequelize');
const { Event, EventParticipant, EventWish, EventWishBlock } = require('../src/models');
const wishes = require('../src/services/clientWish.service');

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
    try {
        // ── Participant writes ────────────────────────────────────────────
        const mine = await wishes.create(guest, event.id, { message: '  Congratulations!  ', photo: '/uploads/test/w.jpg' });
        made.push(mine.id);
        ok('participant wish saved, trimmed', mine.message === 'Congratulations!');
        ok('visible at once (no approval)', mine.status === 'visible' && !mine.is_hidden);
        ok('named from the participant row', mine.guest_name === String(joined.name).trim().slice(0, 150), mine.guest_name);
        ok('marked as mine, editable', mine.is_mine && mine.can_edit && mine.can_delete);
        await refused('participant: empty message refused', () => wishes.create(guest, event.id, { message: '  ' }), 400);

        // ── Organizer adds on someone's behalf ────────────────────────────
        const theirs = await wishes.create(owner, event.id, {
            guest_name: 'ZzWish Test', mobile: '98765 43210', message: 'Best wishes', show_in_app: false,
        });
        made.push(theirs.id);
        ok('organizer wish: hidden when Show in App off', theirs.status === 'hidden');
        ok('organizer wish: mobile cleaned', theirs.mobile === '9876543210', theirs.mobile);
        ok('organizer wish: added_by_organizer', theirs.added_by_organizer === true);
        await refused('organizer: name required', () => wishes.create(owner, event.id, { message: 'x' }), 400);
        await refused('organizer: bad mobile refused', () => wishes.create(owner, event.id, { guest_name: 'a', message: 'x', mobile: 'abc' }), 400);

        // ── What each side sees ───────────────────────────────────────────
        let g = await wishes.list(guest, event.id);
        ok('participant does not see a hidden wish', !g.wishes.some((w) => w.id === theirs.id));
        ok('participant sees own wish', g.wishes.some((w) => w.id === mine.id));
        ok('participant: no counts, cannot manage', !g.counts && g.can_manage === false && g.is_blocked === false);
        let o = await wishes.list(owner, event.id);
        ok('organizer sees both', [mine.id, theirs.id].every((id) => o.wishes.some((w) => w.id === id)));
        ok('organizer counts add up', o.counts.all === o.counts.visible + o.counts.hidden + o.counts.blocked);

        await wishes.update(owner, theirs.id, { show_in_app: true });
        g = await wishes.list(guest, event.id);
        const shown = g.wishes.find((w) => w.id === theirs.id);
        ok('shown again: participant sees it', !!shown);
        ok('...but not its mobile', shown && shown.mobile === null);
        await wishes.update(owner, theirs.id, { show_in_app: false });
        await refused('participant cannot read a hidden wish by id', () => wishes.getOne(guest, theirs.id), 404);

        // ── Edit rights ───────────────────────────────────────────────────
        const edited = await wishes.update(guest, mine.id, { message: 'Edited by me', guest_name: 'Hacker', show_in_app: false });
        ok('participant edits own message', edited.message === 'Edited by me');
        ok('...cannot rename or hide it', edited.guest_name === mine.guest_name && edited.status === 'visible');
        await refused('participant cannot edit the organizer wish', () => wishes.update(guest, theirs.id, { message: 'x' }), 403);
        await refused('participant cannot delete the organizer wish', () => wishes.remove(guest, theirs.id), 403);
        const renamed = await wishes.update(owner, mine.id, { guest_name: 'Renamed' });
        ok('organizer cannot rename a participant wish', renamed.guest_name === mine.guest_name);

        // ── Hide a participant's wish ─────────────────────────────────────
        await wishes.update(owner, mine.id, { show_in_app: false });
        g = await wishes.list(guest, event.id);
        ok('writer still sees own hidden wish', g.wishes.some((w) => w.id === mine.id && w.is_hidden));
        await wishes.update(owner, mine.id, { show_in_app: true });

        // ── Block ─────────────────────────────────────────────────────────
        await refused('participant cannot block', () => wishes.setBlocked(guest, mine.id, true), 403);
        await refused('organizer-added wish: nobody to block', () => wishes.setBlocked(owner, theirs.id, true), 400);
        const blocked = await wishes.setBlocked(owner, mine.id, true);
        ok('blocked: status blocked for the organizer', blocked.status === 'blocked' && blocked.author_blocked);
        await wishes.setBlocked(owner, mine.id, true);
        ok('blocking twice keeps one row', (await EventWishBlock.count({ where: { event_id: event.id, author_client_id: guest } })) === 1);
        o = await wishes.list(owner, event.id);
        ok('organizer Blocked count includes it', o.counts.blocked >= 1);
        g = await wishes.list(guest, event.id);
        ok('participant told they are blocked', g.is_blocked === true);
        ok('their existing wish still shows to participants', g.wishes.some((w) => w.id === mine.id && w.status === 'visible'));
        await refused('blocked: new wish refused', () => wishes.create(guest, event.id, { message: 'again' }), 403);
        await refused('blocked: edit refused', () => wishes.update(guest, mine.id, { message: 'again' }), 403);
        await refused('blocked: photo upload refused', () => wishes.uploadPhoto(guest, event.id, { buffer: Buffer.from('x'), mimetype: 'image/jpeg' }), 403);

        await wishes.setBlocked(owner, mine.id, false);
        const again = await wishes.create(guest, event.id, { message: 'After unblock' });
        made.push(again.id);
        ok('unblocked: can write again', again.status === 'visible');

        // ── Delete ────────────────────────────────────────────────────────
        await wishes.remove(guest, again.id);
        ok('participant deletes own', !(await EventWish.findByPk(again.id)));
        await wishes.remove(owner, theirs.id);
        ok('organizer deletes', !(await EventWish.findByPk(theirs.id)));
    } catch (e) {
        fail++; console.log('  FAIL  unexpected:', e.message);
    } finally {
        await EventWish.destroy({ where: { id: made } });
        await EventWishBlock.destroy({ where: { event_id: event.id, author_client_id: guest } });
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
