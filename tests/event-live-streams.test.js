/*
 * Live Streaming — through the service (no server needed).
 *
 * ── WHAT THIS FILE IS GUARDING ──────────────────────────────────────────────
 *   · an event starts with NO stream types (no built-in one)
 *   · the HOST adds / renames / reorders / deletes stream types; duplicate names refused
 *   · deleting a type deletes its streams too
 *   · a stream needs a type, title, platform, a http(s) link, date and time
 *   · another event's type is refused
 *   · Disable / Enable (is_enabled) and the Enabled / Disabled counts
 *   · a participant sees ENABLED streams only, and only types that hold one;
 *     a disabled stream cannot be opened by them; they cannot write anything
 *   · a stranger (neither host nor participant) is refused
 *
 * Everything it creates is deleted.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/event-live-streams.test.js
 * Needs the local DB migrated with apply-event-live-streams.js, and an event
 * that has a joined participant (participant_client_id set).
 */
require('dotenv').config();

const { Op } = require('sequelize');
const { sequelize, Event, EventParticipant, EventLiveStream, EventLiveStreamType } = require('../src/models');
const live = require('../src/services/clientLiveStream.service');

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
    const otherEvent = await Event.findOne({ where: { id: { [Op.ne]: event.id } }, attributes: ['id', 'website_client_id'] });

    // Rows that existed before — left alone; everything newer is ours to delete.
    const beforeTypes = new Set((await EventLiveStreamType.findAll({ attributes: ['id'] })).map((r) => r.id));
    const beforeStreams = new Set((await EventLiveStream.findAll({ attributes: ['id'] })).map((r) => r.id));

    const base = {
        title: 'Wedding Ceremony Live',
        platform: 'youtube',
        stream_url: 'https://www.youtube.com/watch?v=abc123',
        stream_date: '2024-11-24',
        stream_time: '10:00',
        description: 'Join us live',
        cover_image: '/uploads/test/live-cover.jpg',
    };

    try {
        console.log(`Event #${event.id} · host #${host} · participant #${guest}`);

        // ── Types ────────────────────────────────────────────────────────
        const t0 = await live.listTypes(host, event.id);
        ok('no built-in type: the list starts empty', t0.types.length === 0, JSON.stringify(t0.types.map((t) => t.name)));
        ok('host can_edit', t0.can_edit === true);
        ok('Live Streaming menu reported', !!t0.menu_id, JSON.stringify(t0.menu_id));

        const { type: ceremony } = await live.createType(host, event.id, { name: 'ZzTest Ceremony' });
        const { type: reception } = await live.createType(host, event.id, { name: 'ZzTest Reception', description: 'Evening' });
        ok('host adds two types', !!ceremony && !!reception && reception.description === 'Evening');
        ok('duplicate type name refused', /already a stream type/.test(await refused(() => live.createType(host, event.id, { name: 'ZzTest Ceremony' })) || ''));
        ok('empty type name refused', /mandatory/.test(await refused(() => live.createType(host, event.id, { name: '  ' })) || ''));
        ok('participant cannot add a type', !!(await refused(() => live.createType(guest, event.id, { name: 'X' }))));
        const renamed = await live.updateType(host, ceremony.id, { name: 'ZzTest Wedding Ceremony' });
        ok('host renames a type', renamed.type.name === 'ZzTest Wedding Ceremony');

        const re = await live.reorderTypes(host, event.id, { ids: [reception.id, ceremony.id] });
        const order = re.types.map((t) => t.id);
        ok('reorder saves the order sent', order[0] === reception.id && order[1] === ceremony.id, order.join(','));

        // ── Streams ──────────────────────────────────────────────────────
        const s1 = await live.create(host, event.id, { ...base, type_id: ceremony.id });
        ok('host adds a stream in a type', s1.type_id === ceremony.id && s1.type_name === 'ZzTest Wedding Ceremony' && s1.is_enabled === true && s1.stream_time === '10:00');
        const s2 = await live.create(host, event.id, { ...base, title: 'Reception Live', platform: 'facebook', type_id: ceremony.id, is_enabled: false, stream_time: '19:00' });
        ok('stream saved disabled (Show in App off)', s2.is_enabled === false && s2.platform === 'facebook');
        ok('no type refused', /mandatory/.test(await refused(() => live.create(host, event.id, { ...base, title: 'No type' })) || ''));

        const typed = { ...base, type_id: ceremony.id };
        ok('missing title refused', /mandatory/.test(await refused(() => live.create(host, event.id, { ...typed, title: '' })) || ''));
        ok('bad link refused', /valid link/.test(await refused(() => live.create(host, event.id, { ...typed, stream_url: 'youtube.com/x' })) || ''));
        ok('unknown platform refused', /platform/.test(await refused(() => live.create(host, event.id, { ...typed, platform: 'myspace' })) || ''));
        ok('bad date refused', /valid date/.test(await refused(() => live.create(host, event.id, { ...typed, stream_date: '24-11-2024' })) || ''));
        ok('missing time refused', /mandatory/.test(await refused(() => live.create(host, event.id, { ...typed, stream_time: '' })) || ''));
        if (otherEvent) {
            const foreign = (await live.createType(otherEvent.website_client_id, otherEvent.id, { name: 'ZzTest Foreign' })).type;
            ok("another event's type refused", /valid stream type/.test(await refused(() => live.create(host, event.id, { ...base, type_id: foreign.id })) || ''));
        }
        ok('participant cannot add a stream', !!(await refused(() => live.create(guest, event.id, typed))));
        ok('stranger cannot list', !!(await refused(() => live.list(stranger, event.id))));

        // Host list for the type: both, with counts.
        const hl = await live.list(host, event.id, { type_id: ceremony.id });
        ok('host sees both streams of the type', hl.streams.length === 2);
        ok('counts total 2 · enabled 1 · disabled 1', hl.counts.total === 2 && hl.counts.enabled === 1 && hl.counts.disabled === 1, JSON.stringify(hl.counts));
        ok('platform list returned', hl.platforms.includes('google_meet'));

        // Participant: enabled only; types without an enabled stream hidden.
        const gl = await live.list(guest, event.id, { type_id: ceremony.id });
        ok('participant sees the enabled stream only', gl.streams.length === 1 && gl.streams[0].id === s1.id);
        ok('participant cannot edit', gl.can_edit === false);
        const gt = await live.listTypes(guest, event.id);
        ok('participant: empty type (Reception) hidden', !gt.types.some((t) => t.id === reception.id));
        ok('participant cannot open a disabled stream', !!(await refused(() => live.getOne(guest, s2.id))));
        ok('participant can open an enabled stream', (await live.getOne(guest, s1.id)).stream.id === s1.id);
        ok('participant cannot disable', !!(await refused(() => live.update(guest, s1.id, { is_enabled: false }))));

        // Disable / Enable and edit.
        const off = await live.update(host, s1.id, { is_enabled: false });
        ok('host disables', off.is_enabled === false);
        ok('participant no longer sees the type at all', !(await live.listTypes(guest, event.id)).types.some((t) => t.id === ceremony.id));
        const on = await live.update(host, s1.id, { is_enabled: true });
        ok('host enables again', on.is_enabled === true);
        const edited = await live.update(host, s1.id, { title: 'Wedding Ceremony Live (HD)', type_id: reception.id });
        ok('edit changes only what was sent (title + type)', edited.title === 'Wedding Ceremony Live (HD)' && edited.type_id === reception.id && edited.stream_url === base.stream_url && edited.description === 'Join us live');
        ok('edit with a bad link refused', /valid link/.test(await refused(() => live.update(host, s1.id, { stream_url: 'ftp://x' })) || ''));

        // Delete a stream.
        const s3 = await live.create(host, event.id, { ...base, title: 'Third', type_id: ceremony.id });
        ok('participant cannot delete', !!(await refused(() => live.remove(guest, s1.id))));
        await live.remove(host, s3.id);
        ok('host deletes a stream', !(await EventLiveStream.findByPk(s3.id)));

        // Delete a type → its streams go with it (s2 is in ceremony; s1 moved to reception).
        ok('participant cannot delete a type', !!(await refused(() => live.removeType(guest, ceremony.id))));
        const del = await live.removeType(host, ceremony.id);
        ok('deleting a type deletes its streams', del.streams_removed === 1 && !(await EventLiveStream.findByPk(s2.id)));
        ok('the other type keeps its stream', !!(await EventLiveStream.findByPk(s1.id)));
    } catch (e) {
        fail++;
        console.log(`  FAIL  unexpected error: ${e.stack}`);
    } finally {
        const newStreams = (await EventLiveStream.findAll({ attributes: ['id'] })).map((r) => r.id).filter((id) => !beforeStreams.has(id));
        if (newStreams.length) await EventLiveStream.destroy({ where: { id: newStreams } });
        const newTypes = (await EventLiveStreamType.findAll({ attributes: ['id'] })).map((r) => r.id).filter((id) => !beforeTypes.has(id));
        if (newTypes.length) await EventLiveStreamType.destroy({ where: { id: newTypes } });
        console.log(`\n${pass} passed, ${fail} failed (cleaned ${newStreams.length} streams, ${newTypes.length} types)`);
        await sequelize.close();
        process.exit(fail ? 1 : 0);
    }
})();
