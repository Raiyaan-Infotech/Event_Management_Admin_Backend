/*
 * Client-portal Settings (Preferences + Notifications) — the HTTP layer.
 *
 * Goes through the real stack: routes, `bodyTransform`, the auth middleware,
 * the session cookie and the JSON envelope. Every billing bug so far lived in
 * one of those layers rather than in a service, and there is no reason to
 * expect this module to differ.
 *
 * ── IT RESTORES WHAT IT TOUCHES ─────────────────────────────────────────────
 * It writes real preferences for a real account, so the end of the file deletes
 * the rows this run created. A test that leaves Do Not Disturb switched on for
 * the seeded client poisons whatever is tested next.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-settings-api.test.js
 * Requires the backend running on :5001 and the seeded test client.
 */
require('dotenv').config();

const { sequelize } = require('../src/models');

const BASE = process.env.TEST_API_URL || 'http://localhost:5001/api/v1';
const CREDENTIALS = { email: 'test@example.com', password: 'Test@123' };

let pass = 0, fail = 0;
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

/** Every type in a channel, flattened out of its groups. */
const flat = (channel, data) => data.notifications[channel].flatMap((g) => g.types);
const find = (channel, type, data) => flat(channel, data).find((t) => t.type === type);

(async () => {
    console.log(`\nSettings API against ${BASE}\n`);
    let clientId = null;

    try {
        // ── Nothing is reachable without a session ─────────────────────────
        console.log('── unauthenticated ───────────────────────────────');
        for (const [method, path] of [
            ['GET', '/client/settings'],
            ['PUT', '/client/settings/preferences'],
            ['PUT', '/client/settings/notifications'],
        ]) {
            const res = await call(method, path, method === 'GET' ? undefined : {});
            ok(`${method} ${path} -> 401`, res.status === 401, `got ${res.status}`);
        }

        const login = await call('POST', '/public/website-clients/login', CREDENTIALS);
        ok('signs in', login.status === 200, `got ${login.status}`);
        clientId = login.body?.data?.client?.id;

        // ── First read creates the row and serves the catalogue ────────────
        console.log('\n── GET /client/settings ──────────────────────────');
        const first = await call('GET', '/client/settings');
        ok('200', first.status === 200, `got ${first.status}`);
        const d0 = first.body.data;

        ok('a preference row exists after the first read (findOrCreate)',
            d0.preferences && d0.preferences.website_client_id === clientId,
            JSON.stringify(d0.preferences?.website_client_id));

        ok('the catalogue is SERVED, not left to the UI',
            flat('email', d0).length > 0 && flat('in_app', d0).length > 0,
            `${flat('email', d0).length}/${flat('in_app', d0).length}`);

        ok('every dropdown\'s allowed values come with it',
            ['language_code', 'date_format', 'theme', 'default_landing', 'items_per_page']
                .every((k) => Array.isArray(d0.options[k]) && d0.options[k].length),
            JSON.stringify(Object.keys(d0.options)));

        ok('one language offered, because the table holds one',
            d0.options.language_code.length === 1 && d0.options.language_code[0].value === 'en',
            JSON.stringify(d0.options.language_code));

        ok('every default_landing option names a REAL route',
            d0.options.default_landing.every((o) => typeof o.path === 'string' && o.path.startsWith('/dashboard')),
            JSON.stringify(d0.options.default_landing));

        // ── The types that must NOT be offered ─────────────────────────────
        console.log('\n── the catalogue refuses fictional notifications ──');
        for (const [channel, type, why] of [
            ['email', 'team_member_activity', 'there are no team members'],
            ['in_app', 'guest_checkin', 'nothing records a check-in'],
            ['in_app', 'new_message', 'messaging is paused and unbuilt'],
            ['email', 'surveys_feedback', 'no survey feature exists'],
        ]) {
            ok(`${channel}/${type} absent — ${why}`, !find(channel, type, d0));
        }

        ok('the ones kept name real things (new_rsvp, billing_payments)',
            Boolean(find('email', 'new_rsvp', d0)) && Boolean(find('email', 'billing_payments', d0)));

        // ── Delivery state is DATA, with reasons ───────────────────────────
        console.log('\n── delivery state ────────────────────────────────');
        ok('email reports disabled (no SMTP configured)', d0.delivery.email.enabled === false);
        ok('and carries a reason the screen can print',
            typeof d0.delivery.email.reason === 'string' && d0.delivery.email.reason.length > 20);
        ok('in-app reports disabled (no feed) with a reason',
            d0.delivery.in_app.enabled === false && Boolean(d0.delivery.in_app.reason));
        ok('`applied` says which preferences actually do something',
            d0.applied.theme === true && d0.applied.compact_mode === false,
            JSON.stringify(d0.applied));

        // ── Writing preferences ────────────────────────────────────────────
        console.log('\n── PUT /client/settings/preferences ──────────────');
        const saved = await call('PUT', '/client/settings/preferences', {
            theme: 'dark', date_format: 'MMM DD, YYYY', items_per_page: 50, compact_mode: true,
        });
        ok('accepted', saved.status === 200, `got ${saved.status} ${JSON.stringify(saved.body)}`);
        ok('values came back applied', saved.body?.data?.preferences?.theme === 'dark'
            && saved.body?.data?.preferences?.items_per_page === 50
            && Number(saved.body?.data?.preferences?.compact_mode) === 1,
            JSON.stringify(saved.body?.data?.preferences));
        ok('the write answers with the SAME full shape as the read',
            Boolean(saved.body?.data?.options && saved.body?.data?.delivery && saved.body?.data?.notifications));

        const bad = await call('PUT', '/client/settings/preferences', { theme: 'neon' });
        ok('a value outside the option list -> 400', bad.status === 400, `got ${bad.status}`);
        ok('and the message names the field and the value',
            String(bad.body?.message || '').includes('theme') && String(bad.body?.message).includes('neon'),
            bad.body?.message);

        const escalate = await call('PUT', '/client/settings/preferences', {
            website_client_id: 999999, id: 1, theme: 'light',
        });
        ok('escalation ignored — website_client_id is not editable', escalate.status === 200);
        ok('the row still belongs to this client',
            escalate.body?.data?.preferences?.website_client_id === clientId,
            String(escalate.body?.data?.preferences?.website_client_id));

        const empty = await call('PUT', '/client/settings/preferences', { nonsense: 1 });
        ok('a patch of nothing editable -> 400 rather than a silent no-op',
            empty.status === 400, `got ${empty.status}`);

        // ── Do Not Disturb is a window, and must not be inverted ───────────
        console.log('\n── do not disturb ────────────────────────────────');
        const now = Date.now();
        const inverted = await call('PUT', '/client/settings/preferences', {
            dnd_starts_at: new Date(now + 3600e3).toISOString(),
            dnd_ends_at: new Date(now + 60e3).toISOString(),
        });
        ok('ends-before-starts -> 400 (quiet hours that are never quiet)',
            inverted.status === 400, `got ${inverted.status}`);

        const dnd = await call('PUT', '/client/settings/preferences', {
            dnd_starts_at: new Date(now - 60e3).toISOString(),
            dnd_ends_at: new Date(now + 3600e3).toISOString(),
        });
        ok('a valid window is accepted', dnd.status === 200, `got ${dnd.status}`);
        ok('dnd_active is computed by the server, not left to the UI',
            dnd.body?.data?.dnd_active === true, String(dnd.body?.data?.dnd_active));

        const past = await call('PUT', '/client/settings/preferences', {
            dnd_starts_at: new Date(now - 7200e3).toISOString(),
            dnd_ends_at: new Date(now - 3600e3).toISOString(),
        });
        ok('a window that has passed reads as inactive with nothing running to expire it',
            past.body?.data?.dnd_active === false, String(past.body?.data?.dnd_active));

        const cleared = await call('PUT', '/client/settings/preferences', {
            dnd_starts_at: null, dnd_ends_at: null,
        });
        ok('the window can be cleared', cleared.status === 200
            && cleared.body?.data?.preferences?.dnd_ends_at === null);

        // ── Writing notifications ──────────────────────────────────────────
        console.log('\n── PUT /client/settings/notifications ────────────');
        const notif = await call('PUT', '/client/settings/notifications', {
            items: [
                { channel: 'email', type: 'new_rsvp', enabled: false, frequency: 'daily_digest' },
                { channel: 'in_app', type: 'account_alerts', enabled: true, sound: true },
            ],
        });
        ok('a batch is accepted', notif.status === 200, `got ${notif.status} ${JSON.stringify(notif.body)}`);
        {
            const d = notif.body.data;
            const rsvp = find('email', 'new_rsvp', d);
            const alerts = find('in_app', 'account_alerts', d);
            ok('the email choice came back', rsvp.enabled === false && rsvp.frequency === 'daily_digest',
                JSON.stringify(rsvp));
            ok('the in-app choice came back', alerts.enabled === true && alerts.sound === true,
                JSON.stringify(alerts));
            ok('is_set marks a real choice apart from a default',
                rsvp.is_set === true && find('email', 'event_updates', d).is_set === false);
        }

        const again = await call('PUT', '/client/settings/notifications', {
            items: [{ channel: 'email', type: 'new_rsvp', enabled: true, frequency: 'instant' }],
        });
        ok('saving the same slot twice updates, never duplicates', again.status === 200
            && find('email', 'new_rsvp', again.body.data).frequency === 'instant');
        {
            const [row] = await sequelize.query(
                "SELECT COUNT(*) n FROM client_notification_prefs WHERE website_client_id = ? AND channel='email' AND type='new_rsvp'",
                { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
            );
            ok('one row on that slot, not two', Number(row.n) === 1, `${row.n} rows`);
        }

        for (const [payload, label] of [
            [{ items: [{ channel: 'sms', type: 'new_rsvp' }] }, 'an sms channel (no provider exists)'],
            [{ items: [{ channel: 'email', type: 'team_member_activity' }] }, 'a type that names nothing real'],
            [{ items: [{ channel: 'email', type: 'new_rsvp', frequency: 'hourly' }] }, 'a frequency outside the list'],
            [{ items: [] }, 'an empty batch'],
            [{}, 'no items at all'],
        ]) {
            const res = await call('PUT', '/client/settings/notifications', payload);
            ok(`${label} -> 400`, res.status === 400, `got ${res.status}`);
        }

        {
            const [row] = await sequelize.query(
                "SELECT COUNT(*) n FROM client_notification_prefs WHERE website_client_id = ? AND (channel='email' AND type='team_member_activity')",
                { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
            );
            ok('nothing invalid was stored on the way to the 400', Number(row.n) === 0, `${row.n} rows`);
        }

        // ── Master switches ────────────────────────────────────────────────
        console.log('\n── master switches ───────────────────────────────');
        const master = await call('PUT', '/client/settings/preferences', { emails_disabled: true });
        ok('"disable all emails" is stored on the preference row, not as a type',
            Number(master.body?.data?.preferences?.emails_disabled) === 1);
        ok('and it does not silently rewrite the individual choices',
            find('email', 'new_rsvp', master.body.data).enabled === true,
            'individual rows must stay as the client left them');
    } finally {
        // ── Restore ────────────────────────────────────────────────────────
        console.log('\n── cleanup ───────────────────────────────────────');
        if (clientId) {
            await sequelize.query('DELETE FROM client_notification_prefs WHERE website_client_id = ?', { replacements: [clientId] });
            await sequelize.query('DELETE FROM client_preferences WHERE website_client_id = ?', { replacements: [clientId] });
        }
        const [{ n }] = await sequelize.query(
            'SELECT (SELECT COUNT(*) FROM client_preferences WHERE website_client_id = ?) + (SELECT COUNT(*) FROM client_notification_prefs WHERE website_client_id = ?) n',
            { replacements: [clientId, clientId], type: sequelize.QueryTypes.SELECT },
        );
        ok('test rows removed', Number(n) === 0, `${n} remain`);
        await sequelize.close();
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
