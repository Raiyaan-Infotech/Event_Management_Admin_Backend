/*
 * Event family list — through the service (no server needed).
 *
 * ── WHAT THIS FILE IS GUARDING ──────────────────────────────────────────────
 *   · the HOST adds / edits / reorders / deletes; a participant can only read
 *   · a stranger (neither host nor participant) is refused
 *   · what a participant is sent: never mobile / email / notes / date of birth,
 *     and no photo / relationship once the host switches them off in settings
 *   · a participant cannot open a profile the host turned off
 *   · a member needs a name, a side and a relation; bad mobile / email refused
 *   · Change Order saves, and ignores ids from another event
 *   · "Show in Event App" is the Family menu in `menu_ids` — reported, not stored
 *
 * Everything it creates is deleted, and the event's `family_settings` is put back.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/event-family.test.js
 * Needs the local DB, migrated with apply-event-family-members.js, and an event
 * that has a joined participant (participant_client_id set).
 */
require('dotenv').config();

const { Op } = require('sequelize');
const { sequelize, Event, EventParticipant, EventFamilyMember } = require('../src/models');
const family = require('../src/services/clientFamily.service');

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
        include: [{ model: Event, as: 'event', required: true, attributes: ['id', 'website_client_id', 'family_settings'] }],
    });
    if (!joined || !joined.event) {
        console.log('SKIP  no event with a joined participant on this database');
        process.exit(0);
    }
    const event = joined.event;
    const host = Number(event.website_client_id);
    const guest = Number(joined.participant_client_id);
    const stranger = 999999999;
    const originalSettings = event.family_settings;
    const made = [];

    try {
        console.log(`Event #${event.id} · host #${host} · participant #${guest}`);

        // ── Host: create ──────────────────────────────────────────────────
        const a = await family.create(host, event.id, {
            title: 'Mr.', first_name: 'Rajesh', last_name: 'Kumar', side: 'groom', relationship: 'Father',
            mobile: '98765 43210', dial_code: '+91', email: 'rajesh@example.com', notes: 'Private note',
            date_of_birth: '1960-01-02', photo: '/uploads/test/a.jpg',
        });
        made.push(a.id);
        const b = await family.create(host, event.id, { first_name: 'Sunita', side: 'groom', relationship: 'Mother' });
        made.push(b.id);
        const c = await family.create(host, event.id, { first_name: 'Suresh', last_name: 'Iyer', side: 'bride', relationship: 'Father' });
        made.push(c.id);

        ok('create stores the full name', a.full_name === 'Rajesh Kumar');
        ok('create keeps digits only for the mobile', a.mobile === '9876543210');
        ok('new members land in order', a.sort_order < b.sort_order && b.sort_order < c.sort_order);

        // ── Validation ────────────────────────────────────────────────────
        ok('a member needs a name', !!(await refused(() => family.create(host, event.id, { side: 'groom', relationship: 'Father' }))));
        ok('a member needs a side', !!(await refused(() => family.create(host, event.id, { first_name: 'X', relationship: 'Father' }))));
        ok('a side must be groom or bride', !!(await refused(() => family.create(host, event.id, { first_name: 'X', side: 'both', relationship: 'Father' }))));
        ok('a member needs a relation', !!(await refused(() => family.create(host, event.id, { first_name: 'X', side: 'groom' }))));
        ok('a bad mobile is refused', !!(await refused(() => family.create(host, event.id, { first_name: 'X', side: 'groom', relationship: 'Father', mobile: '123' }))));
        ok('a bad email is refused', !!(await refused(() => family.create(host, event.id, { first_name: 'X', side: 'groom', relationship: 'Father', email: 'nope' }))));
        ok('a future birthday is refused', !!(await refused(() => family.create(host, event.id, { first_name: 'X', side: 'groom', relationship: 'Father', date_of_birth: '2999-01-01' }))));
        ok('a non-upload photo URL is refused', !!(await refused(() => family.create(host, event.id, { first_name: 'X', side: 'groom', relationship: 'Father', photo: 'javascript:alert(1)' }))));

        // ── Who may write ─────────────────────────────────────────────────
        ok('a participant cannot add', !!(await refused(() => family.create(guest, event.id, { first_name: 'Y', side: 'groom', relationship: 'Father' }))));
        ok('a participant cannot edit', !!(await refused(() => family.update(guest, a.id, { first_name: 'Hacked' }))));
        ok('a participant cannot delete', !!(await refused(() => family.remove(guest, a.id))));
        ok('a participant cannot reorder', !!(await refused(() => family.reorder(guest, event.id, { ids: [c.id, b.id, a.id] }))));
        ok('a participant cannot change settings', !!(await refused(() => family.updateSettings(guest, event.id, { profile_photo: false }))));
        ok('a stranger cannot read the list', !!(await refused(() => family.list(stranger, event.id))));
        ok('the member is untouched after the refused writes', (await EventFamilyMember.findByPk(a.id)).name === 'Rajesh Kumar');

        // ── What each side is sent ────────────────────────────────────────
        const hostList = await family.list(host, event.id);
        ok('the host can edit', hostList.can_edit === true);
        ok('the host sees mobile / email / notes',
            hostList.items.find((m) => m.id === a.id).mobile === '9876543210'
            && hostList.items.find((m) => m.id === a.id).email === 'rajesh@example.com'
            && hostList.items.find((m) => m.id === a.id).notes === 'Private note');

        const guestList = await family.list(guest, event.id);
        const seen = guestList.items.find((m) => m.id === a.id);
        ok('a participant reads the list but cannot edit', guestList.can_edit === false && !!seen);
        ok('a participant is never sent mobile / email / notes / date of birth',
            !('mobile' in seen) && !('email' in seen) && !('notes' in seen) && !('date_of_birth' in seen));
        ok('a participant sees photo and relation while the host leaves them on',
            seen.photo === '/uploads/test/a.jpg' && seen.relationship === 'Father');
        ok('the list says whether the Family menu is on for the event',
            Object.prototype.hasOwnProperty.call(hostList, 'show_in_app')
            && Object.prototype.hasOwnProperty.call(hostList, 'menu_id'));

        // ── Settings ──────────────────────────────────────────────────────
        const set = await family.updateSettings(host, event.id, { profile_photo: false, relationship: false, profile_screen: false });
        ok('settings save', set.settings.profile_photo === false && set.settings.relationship === false && set.settings.name === true);
        const trimmed = (await family.list(guest, event.id)).items.find((m) => m.id === a.id);
        ok('a participant gets no photo once the host switches it off', trimmed.photo === null);
        ok('a participant gets no relation once the host switches it off', trimmed.relationship === null);
        ok('the host still sees everything', (await family.list(host, event.id)).items.find((m) => m.id === a.id).photo === '/uploads/test/a.jpg');
        ok('a participant cannot open a profile the host turned off', !!(await refused(() => family.getOne(guest, a.id))));
        ok('the host can still open it', (await family.getOne(host, a.id)).full_name === 'Rajesh Kumar');
        await family.updateSettings(host, event.id, { profile_screen: true, profile_photo: true, relationship: true });
        ok('a participant can open a profile when it is on', (await family.getOne(guest, a.id)).full_name === 'Rajesh Kumar');
        ok('settings can never switch the name off', (await family.updateSettings(host, event.id, { name: false })).settings.name === true);

        // ── Edit ──────────────────────────────────────────────────────────
        const edited = await family.update(host, a.id, { first_name: 'Rajesh', last_name: 'Kumar Sr', relationship: 'Grandfather' });
        ok('edit changes the name and relation', edited.full_name === 'Rajesh Kumar Sr' && edited.relationship === 'Grandfather');
        ok('edit leaves what it did not send', edited.side === 'groom' && edited.mobile === '9876543210');
        const cleared = await family.update(host, a.id, { photo: '' });
        ok('an empty photo clears it', cleared.photo === null);

        // ── Change Order ──────────────────────────────────────────────────
        const reordered = await family.reorder(host, event.id, { ids: [c.id, a.id, b.id, 987654321] });
        const mine = reordered.items.filter((m) => made.includes(m.id)).map((m) => m.id);
        ok('Change Order saves', mine.join() === [c.id, a.id, b.id].join(), mine.join());
        ok('a bad order body is refused', !!(await refused(() => family.reorder(host, event.id, { ids: 'x' }))));

        // ── Delete ────────────────────────────────────────────────────────
        ok('delete removes the member', (await family.remove(host, b.id)).removed === true && !(await EventFamilyMember.findByPk(b.id)));
        ok('an unknown member is a 404', !!(await refused(() => family.getOne(host, b.id))));
    } finally {
        if (made.length) await EventFamilyMember.destroy({ where: { id: { [Op.in]: made } } });
        await Event.update({ family_settings: originalSettings ?? null }, { where: { id: event.id } });
        await sequelize.close();
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(async (e) => {
    console.error(e);
    try { await sequelize.close(); } catch { /* ignore */ }
    process.exit(1);
});
