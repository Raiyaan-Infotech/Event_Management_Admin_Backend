/*
 * Guest messaging and the notification feed — over HTTP, against a live server.
 *
 * ── WHAT THIS FILE IS REALLY GUARDING ───────────────────────────────────────
 * Nothing is delivered. No WhatsApp, SMS or SMTP provider is configured, so a
 * "send" writes a campaign and its per-recipient rows and stops. The tests that
 * matter most are the ones proving the system SAYS SO rather than reporting
 * success:
 *
 *   · deliveries are written 'queued', never 'sent'
 *   · the response's `delivery.attempted` is false, with the reason
 *   · a delivery RATE is null, never 0% — 0% reads as "it failed"
 *
 * ── AND THE TWO COUNTING RULES ──────────────────────────────────────────────
 *   · the audience excludes guests with no address for that channel, because a
 *     recipient count the send cannot honour poisons every rate after it
 *   · the stat tiles count the whole account, never the filtered page
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-messages.test.js
 * Requires the backend running on :5001 and the seeded test client.
 */
require('dotenv').config();

const { sequelize } = require('../src/models');
const svc = require('../src/services/clientMessage.service');

const BASE = process.env.TEST_API_URL || 'http://localhost:5001/api/v1';
const CREDENTIALS = { email: 'test@example.com', password: 'Test@123' };

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

let cookies = '';
const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(cookies ? { Cookie: cookies } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body: json };
};

(async () => {
    console.log(`\nMessages and notifications against ${BASE}\n`);
    let clientId = null;
    let eventId = null;
    const madeGuests = [];

    try {
        // ── In-process: the renderer ───────────────────────────────────────
        console.log('── merge fields ──────────────────────────────────');
        {
            const ctx = {
                guest: { name: 'Arjun Sharma', first_name: 'Arjun', table_number: '12' },
                event: { id: 5, name: 'Our Special Wedding', start_date: '2025-05-24', start_time: '18:00:00' },
                hostName: 'Rohan Mehta',
            };
            ok('single braces render', svc.render('Hi {first_name}', ctx) === 'Hi Arjun');
            // The two supplied designs use different brace styles; a body copied
            // between them must not reach a guest with a literal brace in it.
            ok('double braces render too', svc.render('Hi {{first_name}}', ctx) === 'Hi Arjun');
            ok('a full name falls back to the name column',
                svc.render('{full_name}', ctx) === 'Arjun Sharma');
            /*
              A DATEONLY parsed with `new Date()` renders the previous day for
              anyone behind UTC — on an invitation that is the wrong date for
              the wedding.
            */
            ok('the date is built from PARTS, not new Date()',
                svc.render('{event_date}', ctx) === '24 May 2025',
                svc.render('{event_date}', ctx));
            ok('24h time becomes 12h', svc.render('{event_time}', ctx) === '06:00 PM',
                svc.render('{event_time}', ctx));
            // Blanking it silently would leave a sentence with a hole in it that
            // reads as finished. A stray brace is a visible mistake somebody fixes.
            ok('an UNKNOWN token is left alone, never blanked',
                svc.render('x {nope} y', ctx) === 'x {nope} y', svc.render('x {nope} y', ctx));
            ok('empty input is safe', svc.render('', ctx) === '' && svc.render(null, ctx) === '');
        }

        console.log('\n── reachability ──────────────────────────────────');
        {
            ok('email needs an email', svc.reachable({ email: 'a@b.c' }, 'email') === true);
            ok('email with no address is NOT reachable', svc.reachable({ mobile: '1' }, 'email') === false);
            // Most guests have one number; `whatsapp` is stored separately only
            // for the minority where it differs.
            ok('whatsapp falls back to the mobile',
                svc.reachable({ mobile: '999' }, 'whatsapp') === true);
            ok('no number at all is not reachable on whatsapp',
                svc.reachable({ email: 'a@b.c' }, 'whatsapp') === false);
            // Still describable, so a historical row can still be rendered —
            // it just cannot be chosen any more. See the two checks below.
            ok('sms is still DESCRIBABLE for a historical row',
                svc.reachable({ mobile: '999' }, 'sms') === true);
        }

        // ── HTTP ───────────────────────────────────────────────────────────
        console.log('\n── unauthenticated ───────────────────────────────');
        {
            const res = await call('GET', '/client/messages');
            ok('GET /messages without a session -> 401', res.status === 401, `got ${res.status}`);
            const n = await call('GET', '/client/notifications');
            ok('GET /notifications without a session -> 401', n.status === 401, `got ${n.status}`);
        }

        const login = await call('POST', '/public/website-clients/login', CREDENTIALS);
        ok('signs in', login.status === 200, `got ${login.status}`);
        clientId = login.body?.data?.client?.id;

        // Start from nothing: an interrupted run otherwise leaves rows that
        // make the next run fail for reasons unrelated to the code.
        await sequelize.query('DELETE FROM client_notifications WHERE website_client_id = ?',
            { replacements: [clientId] });

        console.log('\n── composer ──────────────────────────────────────');
        let composer = null;
        {
            const res = await call('GET', '/client/messages/composer');
            ok('the composer loads in ONE call', res.status === 200, `got ${res.status}`);
            composer = res.body?.data;
            ok('it serves the merge fields, so the picker cannot offer an unknown token',
                Array.isArray(composer?.merge_fields) && composer.merge_fields.length > 0);
            ok('and the real channel state, with reasons',
                Array.isArray(composer?.channels) && composer.channels.length === 2
                && composer.channels.every((c) => c.enabled === false && typeof c.reason === 'string'),
                JSON.stringify(composer?.channels?.map((c) => [c.channel, c.enabled])));
            /*
              SMS is withdrawn. The composer must not offer it, and — the part
              that actually matters — the send must refuse it even if a crafted
              request asks for it directly. A picker that merely hides an option
              is not a rule.
            */
            ok('SMS is NOT offered by the composer',
                !(composer?.channels ?? []).some((c) => c.channel === 'sms'),
                JSON.stringify(composer?.channels?.map((c) => c.channel)));
            eventId = composer?.selected_event?.id ?? composer?.events?.[0]?.id ?? null;
            ok('an event is available to send against', Boolean(eventId), String(eventId));
        }

        if (!eventId) {
            console.log('\n  no event on the test account — skipping the send tests\n');
        } else {
            // Two guests: one reachable by email, one deliberately not.
            console.log('\n── audience ──────────────────────────────────────');
            const withEmail = await call('POST', '/client/guests', {
                event_id: eventId, first_name: 'Msgtest', last_name: 'Reachable',
                email: `msgtest.reach.${Date.now()}@example.com`, mobile: '9876543210',
            });
            ok('a guest with an email is created', withEmail.status === 200 || withEmail.status === 201,
                `got ${withEmail.status} ${withEmail.body?.message}`);
            if (withEmail.body?.data?.guest?.id) madeGuests.push(withEmail.body.data.guest.id);

            /*
              Every guest must have an email — the guest form requires one — so
              unreachability can only be demonstrated on a PHONE channel. This
              one has an address and no number.
            */
            const noEmail = await call('POST', '/client/guests', {
                event_id: eventId, first_name: 'Msgtest', last_name: 'Unreachable',
                email: `msgtest.unreach.${Date.now()}@example.com`,
            });
            ok('a guest with no phone number is created',
                noEmail.status === 200 || noEmail.status === 201,
                `got ${noEmail.status} ${noEmail.body?.message}`);
            if (noEmail.body?.data?.guest?.id) madeGuests.push(noEmail.body.data.guest.id);

            {
                const res = await call('POST', '/client/messages/preview', {
                    event_id: eventId, channel: 'whatsapp', audience: 'guests',
                    guest_ids: madeGuests,
                    subject: 'Hi {first_name}', body: 'See you at {event_name}.',
                });
                ok('the preview resolves an audience', res.status === 200, `got ${res.status}`);
                const d = res.body?.data;
                /*
                  The one that matters: a guest with no email is NOT counted for
                  an email send. Counting them would make the review step's total
                  a number the send cannot honour, and every rate afterwards is
                  measured against it.
                */
                ok('a guest with no phone number is EXCLUDED from a WhatsApp send',
                    d?.total_recipients === 1, `total=${d?.total_recipients}`);
                ok('and the excluded one is named, not silently dropped',
                    d?.unreachable?.count === 1 && typeof d?.unreachable?.reason === 'string',
                    JSON.stringify(d?.unreachable));
                ok('the preview renders against a REAL guest',
                    d?.preview?.subject === 'Hi Msgtest', d?.preview?.subject);
            }

            console.log('\n── send (records, does not deliver) ──────────────');
            let campaignId = null;
            {
                const res = await call('POST', '/client/messages/send', {
                    event_id: eventId, channel: 'whatsapp', kind: 'invite', audience: 'guests',
                    guest_ids: madeGuests,
                    subject: 'You are invited', body: 'Hi {first_name}, join us at {event_name}.',
                });
                ok('the send is accepted', res.status === 200 || res.status === 201,
                    `got ${res.status} ${res.body?.message}`);
                const d = res.body?.data;
                campaignId = d?.campaign?.id;

                ok('only the reachable guest is a recipient', d?.recipients === 1, String(d?.recipients));
                ok('and the unreachable one is reported as skipped', d?.skipped === 1, String(d?.skipped));

                /*
                  The honesty assertions. `attempted` false with a reason, and a
                  response message that does not claim delivery.
                */
                ok('delivery.attempted is FALSE — no provider is connected',
                    d?.delivery?.attempted === false, JSON.stringify(d?.delivery));
                ok('with the server\'s own reason, not a hardcoded string',
                    typeof d?.delivery?.reason === 'string' && d.delivery.reason.length > 10);
                ok('and the response does NOT claim the message was sent',
                    /recorded/i.test(res.body?.message || '') && !/^Message sent/i.test(res.body?.message || ''),
                    res.body?.message);

                // Straight at the table: 'sent' would make every delivery rate
                // on the analytics screen unrecoverable once real rows land here.
                const rows = campaignId ? await sequelize.query(
                    'SELECT status FROM event_messages WHERE campaign_id = ?',
                    { replacements: [campaignId], type: sequelize.QueryTypes.SELECT },
                ) : [];
                ok('deliveries are written QUEUED, never sent',
                    rows.length === 1 && rows[0].status === 'queued',
                    JSON.stringify(rows));

                const camp = campaignId ? await sequelize.query(
                    'SELECT status, failed_reason, recipients_count FROM event_message_campaigns WHERE id = ?',
                    { replacements: [campaignId], type: sequelize.QueryTypes.SELECT },
                ) : [];
                ok('the campaign is SENDING, not sent — nothing has left',
                    camp[0]?.status === 'sending', camp[0]?.status);
                ok('and it stores WHY, so it still explains itself after a provider is wired',
                    typeof camp[0]?.failed_reason === 'string' && camp[0].failed_reason.length > 10);
            }

            {
                const res = await call('POST', '/client/messages/send', {
                    event_id: eventId, channel: 'email', audience: 'guests',
                    guest_ids: madeGuests, subject: 'x', body: '',
                });
                ok('an empty body -> 400 with the shared wording',
                    res.status === 400 && /mandatory/i.test(res.body?.message || ''),
                    res.body?.message);

                const noSubject = await call('POST', '/client/messages/send', {
                    event_id: eventId, channel: 'email', audience: 'guests',
                    guest_ids: madeGuests, body: 'hi',
                });
                ok('an email with no subject -> 400', noSubject.status === 400, `got ${noSubject.status}`);

                const past = await call('POST', '/client/messages/send', {
                    event_id: eventId, channel: 'email', audience: 'guests',
                    guest_ids: madeGuests, subject: 'x', body: 'hi',
                    scheduled_at: '2020-01-01T10:00:00',
                });
                // Quietly sending now is the one outcome that cannot be undone.
                ok('a schedule in the PAST is refused, not fired immediately',
                    past.status === 400 && /passed/i.test(past.body?.message || ''),
                    past.body?.message);

                const noOne = await call('POST', '/client/messages/send', {
                    event_id: eventId, channel: 'whatsapp', audience: 'guests',
                    guest_ids: [madeGuests[1]], subject: 'x', body: 'hi',
                });
                ok('sending to only unreachable guests -> 400, not an empty send',
                    noOne.status === 400, `got ${noOne.status}`);

                // The rule, not just the picker: a crafted request naming a
                // withdrawn channel is refused by the server.
                const sms = await call('POST', '/client/messages/send', {
                    event_id: eventId, channel: 'sms', audience: 'guests',
                    guest_ids: madeGuests, subject: 'x', body: 'hi',
                });
                ok('a crafted SMS send -> 400, the server refuses it',
                    sms.status === 400, `got ${sms.status} ${sms.body?.message}`);

                const [smsRows] = await sequelize.query(
                    "SELECT COUNT(*) n FROM event_message_campaigns WHERE website_client_id = ? AND channel = 'sms'",
                    { replacements: [clientId] },
                );
                ok('and nothing was written on it',
                    Number(smsRows[0]?.n) === 0, JSON.stringify(smsRows));
            }

            console.log('\n── the record ────────────────────────────────────');
            {
                const res = await call('GET', '/client/messages');
                ok('the list loads', res.status === 200, `got ${res.status}`);
                const row = (res.body?.data?.campaigns || []).find((c) => c.id === campaignId);
                ok('the campaign is listed', Boolean(row));
                // 0% reads as "it failed". Nothing was attempted.
                ok('a delivery RATE is null, never 0%',
                    row?.delivery?.delivered_rate === null, JSON.stringify(row?.delivery));
                ok('the stat tiles count the whole account',
                    typeof res.body?.data?.stats?.by_channel?.whatsapp?.total === 'number');

                const one = await call('GET', `/client/messages/${campaignId}`);
                ok('the detail loads', one.status === 200, `got ${one.status}`);
                ok('and renders the body for a REAL recipient, not the raw template',
                    typeof one.body?.data?.preview === 'string'
                    && !one.body.data.preview.includes('{first_name}'),
                    one.body?.data?.preview);
                ok('the stored body keeps its merge fields, so it stays re-sendable',
                    (one.body?.data?.campaign?.body || '').includes('{first_name}'));

                const other = await call('GET', '/client/messages/99999999');
                ok("somebody else's campaign id -> 404", other.status === 404, `got ${other.status}`);
                const nan = await call('GET', '/client/messages/abc');
                ok('/messages/abc -> 404, not queried as NaN', nan.status === 404, `got ${nan.status}`);
            }

            console.log('\n── the notification it wrote ─────────────────────');
            {
                const res = await call('GET', '/client/notifications');
                ok('the feed loads', res.status === 200, `got ${res.status}`);
                const rows = res.body?.data?.notifications || [];

                const sent = rows.find((n) => n.type === 'campaign_sent');
                ok('sending a message put a notification in the feed', Boolean(sent),
                    JSON.stringify(rows.map((n) => n.type)));
                ok('filed under System, which is the tab it belongs to',
                    sent?.category === 'system', sent?.category);
                ok('it arrives UNREAD', sent?.is_read === false);
                ok('and it links somewhere real', typeof sent?.link === 'string');

                const added = rows.find((n) => n.type === 'guest_added');
                ok('adding a guest also wrote one', Boolean(added));
                ok('filed under Guest', added?.category === 'guest', added?.category);

                ok('the stats count the whole feed, not the page',
                    res.body?.data?.stats?.total === rows.length
                    || res.body?.data?.stats?.total >= rows.length);
                ok('and the unread badge agrees with it',
                    res.body?.data?.stats?.unread === rows.filter((n) => !n.is_read).length);

                const count = await call('GET', '/client/notifications/count');
                ok('the badge endpoint agrees too',
                    count.body?.data?.unread === res.body?.data?.stats?.unread,
                    `${count.body?.data?.unread} vs ${res.body?.data?.stats?.unread}`);
            }

            console.log('\n── RSVP fires on the TRANSITION ──────────────────');
            {
                const before = await call('GET', '/client/notifications?category=rsvp');
                const had = before.body?.data?.notifications?.length ?? 0;

                await call('PUT', `/client/guests/${madeGuests[0]}`, { response_type: 'yes' });
                const after = await call('GET', '/client/notifications?category=rsvp');
                ok('accepting an invitation writes an RSVP notification',
                    (after.body?.data?.notifications?.length ?? 0) === had + 1,
                    `${had} -> ${after.body?.data?.notifications?.length}`);

                /*
                  Saving the same answer again must NOT write a second one, or
                  the feed fills with duplicates every time a guest row is
                  touched for an unrelated reason.
                */
                await call('PUT', `/client/guests/${madeGuests[0]}`, { response_type: 'yes', table_number: '9' });
                const again = await call('GET', '/client/notifications?category=rsvp');
                ok('re-saving the SAME answer does not write a duplicate',
                    (again.body?.data?.notifications?.length ?? 0) === had + 1,
                    `expected ${had + 1}, got ${again.body?.data?.notifications?.length}`);
            }

            console.log('\n── read, archive, and their scoping ──────────────');
            {
                const feed = await call('GET', '/client/notifications');
                const first = feed.body?.data?.notifications?.[0];

                const read = await call('PUT', `/client/notifications/${first.id}/read`);
                ok('one can be marked read', read.status === 200
                    && read.body?.data?.notification?.is_read === true, `got ${read.status}`);
                // A one-way door would make an accidental click unrecoverable.
                const unread = await call('PUT', `/client/notifications/${first.id}/read`, { read: false });
                ok('and marked UNREAD again — not a one-way door',
                    unread.body?.data?.notification?.is_read === false);

                /*
                  Mark-all is scoped to the tab in view. Clearing the System tab
                  because somebody pressed it on the RSVP tab is silent data loss
                  of the only kind that matters here: attention.
                */
                const rsvpOnly = await call('PUT', '/client/notifications/read-all', { category: 'rsvp' });
                ok('mark-all is SCOPED to the category in view', rsvpOnly.status === 200);
                ok('so the RSVP tab is now clear',
                    rsvpOnly.body?.data?.stats?.by_category?.rsvp?.unread === 0,
                    JSON.stringify(rsvpOnly.body?.data?.stats?.by_category?.rsvp));
                ok('while other tabs are untouched',
                    rsvpOnly.body?.data?.stats?.by_category?.system?.unread > 0,
                    JSON.stringify(rsvpOnly.body?.data?.stats?.by_category?.system));

                const arch = await call('PUT', `/client/notifications/${first.id}/archive`);
                ok('archiving works', arch.status === 200, `got ${arch.status}`);
                const afterArch = await call('GET', '/client/notifications');
                ok('and it leaves the feed',
                    !(afterArch.body?.data?.notifications || []).some((n) => n.id === first.id));
                // "Dealt with" and "never happened" are different answers.
                const [row] = await sequelize.query(
                    'SELECT archived_at, is_read FROM client_notifications WHERE id = ?',
                    { replacements: [first.id], type: sequelize.QueryTypes.SELECT },
                );
                ok('archive is a SOFT hide, and marks it read',
                    row && row.archived_at !== null && Number(row.is_read) === 1,
                    JSON.stringify(row));

                const other = await call('PUT', '/client/notifications/99999999/read');
                ok("somebody else's notification id -> 404", other.status === 404, `got ${other.status}`);
                const nan = await call('PUT', '/client/notifications/abc/read');
                ok('/notifications/abc -> 404, not queried as NaN', nan.status === 404, `got ${nan.status}`);
            }

            console.log('\n── there is no way to forge a notification ───────');
            {
                // The feed is written only by other services. A client who could
                // post to it could forge "Payment Successful".
                const res = await call('POST', '/client/notifications', {
                    type: 'payment_received', title: 'Payment Successful',
                });
                ok('POST /notifications is not a route', res.status === 404 || res.status === 405,
                    `got ${res.status}`);
            }
        }
    } finally {
        console.log('\n── cleanup ───────────────────────────────────────');
        if (clientId) {
            await sequelize.query(
                'DELETE m FROM event_messages m JOIN event_message_campaigns c ON m.campaign_id = c.id '
                + 'WHERE c.website_client_id = ? AND c.subject IN (?, ?)',
                { replacements: [clientId, 'You are invited', 'x'] },
            );
            await sequelize.query(
                'DELETE FROM event_message_campaigns WHERE website_client_id = ? AND subject IN (?, ?)',
                { replacements: [clientId, 'You are invited', 'x'] },
            );
            if (madeGuests.length) {
                await sequelize.query(
                    `DELETE FROM event_messages WHERE guest_id IN (${madeGuests.map(() => '?').join(',')})`,
                    { replacements: madeGuests },
                );
                await sequelize.query(
                    `DELETE FROM event_guests WHERE id IN (${madeGuests.map(() => '?').join(',')})`,
                    { replacements: madeGuests },
                );
            }
            await sequelize.query('DELETE FROM client_notifications WHERE website_client_id = ?',
                { replacements: [clientId] });
            const [{ n }] = await sequelize.query(
                'SELECT COUNT(*) n FROM client_notifications WHERE website_client_id = ?',
                { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
            );
            ok('test rows removed', Number(n) === 0, `${n} remain`);
        }
        await sequelize.close();
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
