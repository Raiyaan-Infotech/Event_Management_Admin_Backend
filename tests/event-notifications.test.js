/**
 * The organizer's notifications from the mobile app — `event_notifications`
 * (clientEventNotification.service). Runs against the LOCAL database, no
 * server needed:
 *
 *   node tests/event-notifications.test.js
 *
 * It sends only to a participant who has NOT joined the app, so no push leaves
 * the machine, and it deletes every row it wrote.
 */
require('dotenv').config();
const m = require('../src/models');
const svc = require('../src/services/clientEventNotification.service');

const ok = (label, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`);
    if (!cond) process.exitCode = 1;
};
const fails = async (label, fn, text) => {
    try { await fn(); ok(label, false, '(did not throw)'); } catch (e) {
        ok(label, !text || e.message.includes(text), `-> ${e.message}`);
    }
};

(async () => {
    // time zone arithmetic
    const at = svc.instantOf('2026-12-01', '09:30', '(GMT +05:30) India Standard Time');
    ok('instantOf IST', at.toISOString() === '2026-12-01T04:00:00.000Z', at.toISOString());
    const at2 = svc.instantOf('2026-12-01', '09:30', 'Hawaii (GMT-10:00)');
    ok('instantOf -10', at2.toISOString() === '2026-12-01T19:30:00.000Z', at2.toISOString());
    const wc = svc.wallClock(at, '(GMT +05:30) India');
    ok('wallClock round trip', wc.date === '2026-12-01' && wc.time === '09:30', JSON.stringify(wc));
    ok('no offset -> null', svc.instantOf('2026-12-01', '09:30', 'Somewhere') === null);

    // an event with a participant who has NOT joined the app
    // Prefer an event that ALSO has somebody with the app, so the in-app and
    // bell checks below are not skipped.
    const withApp = await m.EventParticipant.findAll({
        where: { participant_client_id: { [m.Sequelize.Op.ne]: null } },
        attributes: ['event_id'],
        group: ['event_id'],
        raw: true,
    });
    const p = (await m.EventParticipant.findOne({
        where: { participant_client_id: null, event_id: withApp.map((r) => r.event_id) },
        order: [['id', 'DESC']],
    })) || await m.EventParticipant.findOne({
        where: { participant_client_id: null },
        order: [['id', 'DESC']],
    });
    if (!p) { console.log('no app-less participant locally — cannot test send'); return; }
    const event = await m.Event.findByPk(p.event_id);
    const clientId = event.website_client_id;
    console.log(`event ${event.id} owner ${clientId} participant ${p.id} side=${p.rsvp_side} rel=${p.relationship}`);

    const opts = await svc.audienceOptions(clientId, event.id);
    ok('audienceOptions', opts.total >= 1 && opts.participants.some((x) => x.id === p.id),
        `total=${opts.total} sides=${JSON.stringify(opts.sides)} rels=${opts.relationships.length}`);

    await fails('other client cannot list', () => svc.list(clientId + 999999, event.id), 'not on your account');
    await fails('draft needs a title', () => svc.create(clientId, event.id, { action: 'draft', title: ' ' }), 'title');

    const created = [];
    const d = await svc.create(clientId, event.id, { action: 'draft', title: 'SMOKE draft' });
    created.push(d.notification.id);
    ok('draft saved with title only', d.notification.status === 'draft' && d.notification.message === '');

    await fails('send needs a message', () => svc.update(clientId, d.notification.id, { action: 'send', title: 'x' }), 'message');
    await fails('specific needs a participant', () => svc.update(clientId, d.notification.id, {
        action: 'send', title: 'x', message: 'y', audience: 'specific', participant_ids: [],
    }), 'participant');
    await fails('groups needs a side', () => svc.update(clientId, d.notification.id, {
        action: 'send', title: 'x', message: 'y', audience: 'groups', sides: [],
    }), 'side');
    await fails('a send needs a channel', () => svc.update(clientId, d.notification.id, {
        action: 'send', title: 'x', message: 'y', channels: [],
    }), 'In-App');
    await fails('email is not a channel', () => svc.update(clientId, d.notification.id, {
        action: 'send', title: 'x', message: 'y', channels: ['email', 'whatsapp'],
    }), 'In-App');
    await fails('past time refused', () => svc.update(clientId, d.notification.id, {
        action: 'schedule', title: 'x', message: 'y', audience: 'specific', participant_ids: [p.id],
        scheduled_date: '2020-01-01', scheduled_time: '10:00', timezone: '(GMT +05:30) IST',
    }), 'passed');

    const s = await svc.update(clientId, d.notification.id, {
        action: 'schedule', title: 'SMOKE scheduled', message: 'hello', audience: 'specific', participant_ids: [p.id],
        scheduled_date: '2030-01-01', scheduled_time: '10:00', timezone: '(GMT +05:30) IST',
    });
    ok('scheduled', s.notification.status === 'scheduled' && s.notification.scheduled_date === '2030-01-01'
        && s.notification.scheduled_time === '10:00' && s.notification.recipients_count === 1,
    JSON.stringify({ at: s.notification.scheduled_at, n: s.notification.recipients_count }));

    const r = await svc.reschedule(clientId, d.notification.id, {
        scheduled_date: '2030-02-02', scheduled_time: '18:45', timezone: '(GMT -05:00) Eastern',
    });
    ok('rescheduled', r.scheduled_date === '2030-02-02' && r.scheduled_time === '18:45'
        && new Date(r.scheduled_at).toISOString() === '2030-02-02T23:45:00.000Z', String(new Date(r.scheduled_at).toISOString()));

    const due = await svc.sendDue();
    ok('scheduler leaves a future one alone', (await svc.getOne(clientId, d.notification.id)).status === 'scheduled', JSON.stringify(due));

    const sent = await svc.update(clientId, d.notification.id, {
        action: 'send', title: 'SMOKE sent', message: 'hello', audience: 'specific', participant_ids: [p.id],
    });
    ok('sent', sent.notification.status === 'sent' && sent.outcome.recipients === 1 && sent.outcome.delivered === 0,
        JSON.stringify(sent.outcome));
    const rec = await m.EventNotificationRecipient.findAll({ where: { notification_id: d.notification.id } });
    ok('recipient row written', rec.length === 1 && rec[0].participant_id === p.id && rec[0].status === 'failed',
        `${rec[0]?.status} / ${rec[0]?.failed_reason}`);
    await fails('sent cannot be edited', () => svc.update(clientId, d.notification.id, { action: 'draft', title: 'x' }), 'cannot be edited');
    await fails('sent cannot be rescheduled', () => svc.reschedule(clientId, d.notification.id, {}), 'Only a scheduled');

    // In-app only: saved for the participant, and NO push leaves — so this one
    // may safely go to somebody who does have the app.
    const joined = await m.EventParticipant.findOne({
        where: { event_id: event.id, participant_client_id: { [m.Sequelize.Op.ne]: null } },
    });
    const inApp = await svc.create(clientId, event.id, {
        action: 'send', title: 'SMOKE in-app', message: 'saved only', channels: ['in_app'],
        audience: 'specific', participant_ids: [p.id, ...(joined ? [joined.id] : [])],
    });
    created.push(inApp.notification.id);
    const inAppRows = await m.EventNotificationRecipient.findAll({ where: { notification_id: inApp.notification.id } });
    const byParticipant = new Map(inAppRows.map((r) => [r.participant_id, r]));
    ok('in-app only: saved, no push', inApp.outcome.push === false
        && inApp.notification.status === 'sent'
        && JSON.stringify(inApp.notification.channels) === '["in_app"]'
        && inAppRows.length === (joined ? 2 : 1)
        && inApp.outcome.delivered === (joined ? 1 : 0),
    JSON.stringify(inApp.outcome));
    ok('in-app only: no account = not reached', byParticipant.get(p.id)?.status === 'failed',
        String(byParticipant.get(p.id)?.failed_reason));
    const bell = await m.ClientNotification.findAll({ where: { type: 'event_notification', event_id: event.id } });
    const mine = bell.filter((b) => Number(b.meta?.event_notification_id) === inApp.notification.id);
    ok('bell: one feed row per account, none for the app-less', mine.length === (joined ? 1 : 0)
        && (!joined || (Number(mine[0].website_client_id) === Number(joined.participant_client_id)
            && mine[0].title === 'SMOKE in-app' && mine[0].category === 'message')),
    `rows=${mine.length}`);
    if (joined) {
        ok('in-app only: account = saved for them', byParticipant.get(joined.id)?.status === 'sent'
            && Number(byParticipant.get(joined.id)?.participant_client_id) === Number(joined.participant_client_id));
    } else {
        console.log('SKIP  no participant with the app on this event');
    }

    const both = await svc.create(clientId, event.id, {
        action: 'schedule', title: 'SMOKE both', message: 'm', channels: ['push', 'in_app', 'email'],
        audience: 'specific', participant_ids: [p.id],
        scheduled_date: '2030-01-01', scheduled_time: '10:00', timezone: '(GMT +00:00) UTC',
    });
    created.push(both.notification.id);
    ok('channels stored, unknown ones dropped',
        JSON.stringify(both.notification.channels) === '["in_app","push"]', JSON.stringify(both.notification.channels));

    // groups resolution (schedule only — nothing is sent)
    if (p.rsvp_side) {
        const g = await svc.create(clientId, event.id, {
            action: 'schedule', title: 'SMOKE groups', message: 'm', audience: 'groups', sides: [p.rsvp_side],
            relationships: p.relationship ? [p.relationship] : [],
            scheduled_date: '2030-01-01', scheduled_time: '10:00', timezone: '(GMT +00:00) UTC',
        });
        created.push(g.notification.id);
        ok('groups audience resolves', g.notification.recipients_count >= 1, `n=${g.notification.recipients_count}`);
    }

    // a due scheduled one is picked up by the scheduler
    const dueOne = await svc.create(clientId, event.id, {
        action: 'schedule', title: 'SMOKE due', message: 'm', audience: 'specific', participant_ids: [p.id],
        scheduled_date: '2030-01-01', scheduled_time: '10:00', timezone: '(GMT +00:00) UTC',
    });
    created.push(dueOne.notification.id);
    await m.EventNotification.update({ scheduled_at: new Date(Date.now() - 60000) }, { where: { id: dueOne.notification.id } });
    const fired = await svc.sendDue();
    const after = await svc.getOne(clientId, dueOne.notification.id);
    ok('scheduler sends a due one', fired.fired >= 1 && after.status === 'sent' && after.recipients_count === 1,
        JSON.stringify({ fired, status: after.status }));

    const listed = await svc.list(clientId, event.id);
    ok('list', created.every((id) => listed.notifications.some((n) => n.id === id)), `n=${listed.notifications.length}`);

    await svc.remove(clientId, dueOne.notification.id);
    await fails('deleted is gone', () => svc.getOne(clientId, dueOne.notification.id), 'not found');

    // clean up everything this script wrote
    const feedRows = (await m.ClientNotification.findAll({ where: { type: 'event_notification', event_id: event.id } }))
        .filter((b) => created.includes(Number(b.meta?.event_notification_id)));
    await m.ClientNotification.destroy({ where: { id: feedRows.map((b) => b.id) } });
    await m.EventNotification.destroy({ where: { id: created }, force: true });
    const left = await m.EventNotificationRecipient.count({ where: { notification_id: created } });
    ok('cleanup', left === 0);
})().catch((e) => { console.error('ERROR', e); process.exitCode = 1; }).finally(() => m.sequelize.close());
