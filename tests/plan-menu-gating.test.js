/*
 * Plan menu gating — admin plan -> client portal -> mobile API, end to end.
 *
 * ── THE SCENARIO ────────────────────────────────────────────────────────────
 *   1. Admin creates a LIMITED plan and a new client on it (service layer —
 *      there are no admin credentials for a test to sign in with).
 *   2. The client signs in to the PORTAL (cookie session, real HTTP) and sees
 *      only the plan's menus; a menu outside the plan is refused on create.
 *   3. The client fills data: an event with the plan's menus, and a guest.
 *   4. The same client signs in as the MOBILE APP (OTP + bearer, real HTTP) and
 *      reads the event back.
 *   5. Admin UPDATES the plan's menus; the portal and the app are re-checked.
 *
 * ── WHAT IT LOCKS ───────────────────────────────────────────────────────────
 *   - `for_website` / `for_mobile` on a plan menu decide what each platform
 *     receives (the app is told apart by `X-Client: flutter`)
 *   - an existing event's `menus` follow the owner's plan AS IT IS NOW, while
 *     its saved `menu_ids` stay untouched — re-granting a menu restores it
 * `gap()` remains for requirements not built yet; there are none today.
 *
 * ── DATA IS KEPT ────────────────────────────────────────────────────────────
 * The run leaves its plan, client, event and guest in place so the phone and
 * the portal can be checked by hand; the credentials are printed at the end.
 * Every row is named "ZZ QA …" / code ZZ_QA_*, and the next run (or
 * `--cleanup`) removes the previous run's rows first.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/plan-menu-gating.test.js            run (clears the last run first)
 *   node tests/plan-menu-gating.test.js --cleanup  only remove ZZ QA test data
 * Requires the backend on :5001, the local database, and OTP_ACCEPT_ANY=true.
 */
require('dotenv').config();

const db = require('../src/models');
const planService = require('../src/services/subscriptionPlan.service');
const clientService = require('../src/services/websiteClient.service');

const BASE = process.env.TEST_API_URL || 'http://localhost:5001/api/v1';
const PASSWORD = 'QaTest@1';
const CLEANUP_ONLY = process.argv.includes('--cleanup');

let pass = 0, fail = 0;
const gaps = [];
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};
const gap = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { gaps.push(label); console.log(`  GAP   ${label}  ${extra}`); }
};

const q = (sql, replacements = []) =>
    db.sequelize.query(sql, { replacements, type: db.Sequelize.QueryTypes.SELECT });

/** One HTTP session. `cookie` mode keeps a jar (portal); `bearer` sends a token (app). */
function session(mode) {
    let cookies = '';
    let token = null;
    const call = async (method, path, body) => {
        const headers = { 'Content-Type': 'application/json' };
        if (mode === 'cookie' && cookies) headers.Cookie = cookies;
        if (mode === 'bearer') {
            headers['X-Client'] = 'flutter';
            if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${BASE}${path}`, {
            method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const setCookie = res.headers.getSetCookie?.() ?? [];
        if (setCookie.length) cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
        let json = null;
        try { json = await res.json(); } catch { /* non-JSON */ }
        return { status: res.status, body: json, data: json?.data };
    };
    call.setToken = (t) => { token = t; };
    return call;
}

const ids = (rows) => (rows || []).map((r) => Number(r.id)).sort((a, b) => a - b);
const same = (a, b) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));
const names = (rows, byId) => ids(rows).map((id) => byId[id] || `#${id}`).join(', ') || '(none)';

/** Removes every ZZ QA row from earlier runs — children before parents. */
async function cleanup() {
    const clients = await q("SELECT id FROM website_clients WHERE name LIKE 'ZZ QA%'");
    const clientIds = clients.map((c) => c.id);
    if (clientIds.length) {
        const events = await q('SELECT id FROM events WHERE website_client_id IN (?)', [clientIds]);
        const eventIds = events.map((e) => e.id);
        if (eventIds.length) {
            await db.sequelize.query('DELETE FROM event_guest_response_logs WHERE event_id IN (?)', { replacements: [eventIds] });
            await db.sequelize.query('DELETE FROM event_guests WHERE event_id IN (?)', { replacements: [eventIds] });
            await db.sequelize.query('DELETE FROM client_notifications WHERE website_client_id IN (?)', { replacements: [clientIds] }).catch(() => {});
            await db.sequelize.query('DELETE FROM events WHERE id IN (?)', { replacements: [eventIds] });
        }
        await db.sequelize.query('DELETE FROM website_client_sessions WHERE website_client_id IN (?)', { replacements: [clientIds] }).catch(() => {});
        await db.sequelize.query('DELETE FROM website_clients WHERE id IN (?)', { replacements: [clientIds] });
    }
    const plans = await q("SELECT id FROM subscription_plans WHERE plan_code LIKE 'ZZ_QA_%'");
    const planIds = plans.map((p) => p.id);
    if (planIds.length) {
        await db.sequelize.query('DELETE FROM subscription_plan_menus WHERE plan_id IN (?)', { replacements: [planIds] });
        await db.sequelize.query('DELETE FROM subscription_plans WHERE id IN (?)', { replacements: [planIds] });
    }
    console.log(`  cleanup: removed ${clientIds.length} client(s), ${planIds.length} plan(s) from earlier runs`);
}

(async () => {
    console.log(`\nPlan menu gating against ${BASE}\n`);
    await cleanup();
    if (CLEANUP_ONLY) return;

    // ── The menus under test, by slug so ids are never assumed ─────────────
    const menuRows = await q(
        "SELECT id, name, slug FROM event_menus WHERE slug IN ('event-information','gallery','agenda','rsvp') AND is_active = 1",
    );
    const M = Object.fromEntries(menuRows.map((m) => [m.slug, Number(m.id)]));
    const byId = Object.fromEntries(menuRows.map((m) => [Number(m.id), m.name]));
    if (Object.keys(M).length !== 4) throw new Error('Expected event menus event-information, gallery, agenda, rsvp to exist and be active.');

    const stamp = Date.now().toString().slice(-6);
    const mobile = `70${stamp}${String(Math.floor(Math.random() * 90) + 10)}`;
    const email = `zzqa.${stamp}@example.com`;

    // ══ 1. ADMIN — limited plan + new client ═══════════════════════════════
    console.log('── 1. admin: limited plan + client ─────────────────');
    const plan = await planService.create({
        name: `ZZ QA Limited Plan ${stamp}`,
        plan_code: `ZZ_QA_${stamp}`,
        billing_cycle: 'monthly',
        price: 0,
        for_website: 1,
        for_mobile: 1,
        is_active: 1,
        is_visible: 0,
        menus: [
            { menu_id: M['event-information'], for_website: 1, for_mobile: 1 },
            { menu_id: M.agenda, for_website: 1, for_mobile: 0 },   // WEBSITE ONLY
            { menu_id: M.rsvp, for_website: 1, for_mobile: 1 },
        ],
    });
    ok('plan created with 3 menus', plan && (plan.planMenus || []).length === 3, JSON.stringify(plan?.planMenus));
    console.log(`        plan ${plan.id}: Event Information (web+mobile), Agenda (WEB ONLY), RSVP (web+mobile)`);

    const client = await clientService.create({
        name: `ZZ QA Client ${stamp}`,
        email,
        mobile,
        dial_code: '+91',
        password: PASSWORD,
        is_active: 1,
        subscription_plan_id: plan.id,
    });
    ok('client created on the plan', client && Number(client.subscription_plan_id) === Number(plan.id));

    // ══ 2. PORTAL — sign in, see only the plan's menus ═════════════════════
    console.log('\n── 2. client portal (cookie session) ───────────────');
    const portal = session('cookie');
    const login = await portal('POST', '/public/website-clients/login', { email, password: PASSWORD });
    ok('portal login -> 200, no 2FA', login.status === 200 && !login.data?.requires_2fa, `${login.status} ${login.body?.message}`);

    const me = await portal('GET', '/client/me');
    const mePlan = me.data?.client?.plan ?? me.data?.plan;
    ok('/client/me carries the new plan', mePlan && Number(mePlan.id) === Number(plan.id), JSON.stringify(me.body)?.slice(0, 200));

    const webOpts = await portal('GET', '/client/event-options');
    const webMenus = webOpts.data?.menus ?? webOpts.data?.options?.menus;
    console.log(`        portal is offered: ${names(webMenus, byId)}`);
    ok('portal offered exactly the plan\'s menus', same(ids(webMenus), [M['event-information'], M.agenda, M.rsvp]));

    const category = (webOpts.data?.categories ?? [])[0];
    const type = (webOpts.data?.types ?? []).find((t) => !category || !t.event_category_id || t.event_category_id === category.id);
    ok('plan scope offers a category and a type', Boolean(category && type));
    ok('portal_sections is returned and kept out of menus',
        Array.isArray(webOpts.data?.portal_sections)
        && !(webMenus || []).some((m) => m.menu_group === 'portal'),
        JSON.stringify(webOpts.data?.portal_sections));

    const eventBody = (menuIds, name) => ({
        name, event_category_id: category?.id, event_type_id: type?.id,
        start_date: '2026-12-20', end_date: '2026-12-20', start_time: '18:00', end_time: '22:00',
        venue_name: 'QA Hall', venue_address: 'Chennai',
        organizer: 'ZZ QA Family', contact_phone: '+91 98840 00000', contact_email: email,
        menu_ids: menuIds,
    });

    const refused = await portal('POST', '/client/events', eventBody([M['event-information'], M.gallery], 'ZZ QA Refused'));
    ok('create with Gallery (not in plan) -> 400', refused.status === 400, `${refused.status} ${refused.body?.message}`);

    // ══ 3. PORTAL — fill data ═══════════════════════════════════════════════
    console.log('\n── 3. portal: create event + guest ─────────────────');
    const created = await portal('POST', '/client/events', eventBody([M['event-information'], M.agenda, M.rsvp], `ZZ QA Wedding ${stamp}`));
    const event = created.data?.event;
    ok('event created with the plan\'s 3 menus', created.status === 201 && event, `${created.status} ${created.body?.message}`);
    if (!event) throw new Error('Cannot continue without an event.');
    console.log(`        event ${event.id}: menus ${names(event.menus, byId)}`);

    const guest = await portal('POST', '/client/guests', {
        event_id: event.id, first_name: 'QA', last_name: 'Guest', email: `zzqa.guest.${stamp}@example.com`,
        mobile: `71${stamp}00`, dial_code: '+91',
    });
    ok('guest added', [200, 201].includes(guest.status), `${guest.status} ${guest.body?.message}`);

    // ══ 4. MOBILE — the same client, as the app ════════════════════════════
    console.log('\n── 4. mobile API (OTP + bearer) ────────────────────');
    const app = session('bearer');
    const otpReq = await app('POST', '/public/website-clients/login/otp/request', { mobile, dial_code: '+91' });
    ok('OTP request -> 200', otpReq.status === 200, `${otpReq.status} ${otpReq.body?.message}`);
    const otpVer = await app('POST', '/public/website-clients/login/otp/verify', { mobile, dial_code: '+91', code: '123456', otp: '123456' });
    ok('OTP verify -> access token', otpVer.status === 200 && otpVer.data?.access_token, `${otpVer.status} ${otpVer.body?.message}`);
    app.setToken(otpVer.data?.access_token);

    const appOpts = await app('GET', '/client/event-options');
    const appMenus = appOpts.data?.menus ?? appOpts.data?.options?.menus;
    console.log(`        app is offered:    ${names(appMenus, byId)}`);
    ok('mobile gets only for_mobile menus (Agenda is web-only)',
        same(ids(appMenus), [M['event-information'], M.rsvp]),
        `got ${names(appMenus, byId)}`);

    const appEvent = await app('GET', `/client/events/${event.id}`);
    const ev = appEvent.data?.event;
    ok('mobile reads the event', appEvent.status === 200 && ev);
    console.log(`        app event menus:   ${names(ev?.menus, byId)}`);
    ok('mobile event stats: 1 invited, 0 joined, 0 sent',
        ev?.stats && ev.stats.invited_guests === 1 && ev.stats.guests_joined === 0 && ev.stats.invitations_sent === 0,
        JSON.stringify(ev?.stats));
    ok('mobile event shows only for_mobile menus (no Agenda)',
        same(ids(ev?.menus), [M['event-information'], M.rsvp]),
        `got ${names(ev?.menus, byId)}`);

    const webEvent = await portal('GET', `/client/events/${event.id}`);
    ok('portal event still shows all 3 (Agenda is on the website)',
        same(ids(webEvent.data?.event?.menus), [M['event-information'], M.agenda, M.rsvp]),
        `got ${names(webEvent.data?.event?.menus, byId)}`);
    ok('menu_ids on the event are untouched',
        same((webEvent.data?.event?.menu_ids || []).map(Number), [M['event-information'], M.agenda, M.rsvp]));

    const appList = await app('GET', '/client/events');
    ok('mobile events list contains the event', (appList.data ?? []).some?.((e) => e.id === event.id)
        || (Array.isArray(appList.body?.data) && appList.body.data.some((e) => e.id === event.id)));

    // ══ 5. ADMIN — update the plan, re-check both platforms ════════════════
    console.log('\n── 5. admin updates plan: -Agenda +Gallery ─────────');
    await planService.update(plan.id, {
        menus: [
            { menu_id: M['event-information'], for_website: 1, for_mobile: 1 },
            { menu_id: M.gallery, for_website: 1, for_mobile: 1 },
            { menu_id: M.rsvp, for_website: 1, for_mobile: 1 },
        ],
    });

    const webOpts2 = await portal('GET', '/client/event-options');
    const webMenus2 = webOpts2.data?.menus ?? webOpts2.data?.options?.menus;
    console.log(`        portal is offered: ${names(webMenus2, byId)}`);
    ok('portal offer updated immediately (Gallery in, Agenda out)',
        same(ids(webMenus2), [M['event-information'], M.gallery, M.rsvp]));

    const agendaNow = await portal('POST', '/client/events', eventBody([M.agenda], 'ZZ QA Refused 2'));
    ok('create with Agenda after removal -> 400', agendaNow.status === 400, `${agendaNow.status}`);

    const appOpts2 = await app('GET', '/client/event-options');
    const appMenus2 = appOpts2.data?.menus ?? appOpts2.data?.options?.menus;
    console.log(`        app is offered:    ${names(appMenus2, byId)}`);
    ok('mobile offer updated immediately', same(ids(appMenus2), [M['event-information'], M.gallery, M.rsvp]));

    const webEvent2 = await portal('GET', `/client/events/${event.id}`);
    const appEvent2 = await app('GET', `/client/events/${event.id}`);
    console.log(`        existing event, portal: ${names(webEvent2.data?.event?.menus, byId)}`);
    console.log(`        existing event, app:    ${names(appEvent2.data?.event?.menus, byId)}`);
    ok('existing event drops Agenda once the plan no longer includes it (portal)',
        same(ids(webEvent2.data?.event?.menus), [M['event-information'], M.rsvp]),
        `still shows ${names(webEvent2.data?.event?.menus, byId)}`);
    ok('existing event drops Agenda once the plan no longer includes it (app)',
        same(ids(appEvent2.data?.event?.menus), [M['event-information'], M.rsvp]),
        `still shows ${names(appEvent2.data?.event?.menus, byId)}`);

    // Nothing was deleted from the event — putting Agenda back restores it.
    await planService.update(plan.id, {
        menus: [
            { menu_id: M['event-information'], for_website: 1, for_mobile: 1 },
            { menu_id: M.gallery, for_website: 1, for_mobile: 1 },
            { menu_id: M.agenda, for_website: 1, for_mobile: 1 },
            { menu_id: M.rsvp, for_website: 1, for_mobile: 1 },
        ],
    });
    const appEvent3 = await app('GET', `/client/events/${event.id}`);
    ok('re-adding Agenda to the plan (web+mobile) brings it back on the app',
        same(ids(appEvent3.data?.event?.menus), [M['event-information'], M.agenda, M.rsvp]),
        `got ${names(appEvent3.data?.event?.menus, byId)}`);

    // ══ 6. RSVP follows the plan — QR registration + RSVP tab ══════════════
    // RSVP is ON only when the event carries the rsvp menu AND the host's plan
    // grants it on mobile. Off means: the form does not ask, join stores no
    // answer even if one is sent, and the RSVP tab refuses.
    console.log('\n── 6. RSVP gating (QR join + RSVP tab) ─────────────');
    const ownerView = await portal('GET', `/client/events/${event.id}`);
    const qrToken = ownerView.data?.event?.qr_token;
    ok('owner can read the event QR token', Boolean(qrToken));

    const scanner = session('bearer');
    const resolvedOn = await scanner('POST', '/public/events/qr/resolve', { token: qrToken });
    ok('RSVP on (plan has RSVP): QR resolve says rsvp_enabled = true',
        resolvedOn.data?.rsvp_enabled === true, `${resolvedOn.status} ${JSON.stringify(resolvedOn.body)?.slice(0, 160)}`);

    const withoutRsvp = [
        { menu_id: M['event-information'], for_website: 1, for_mobile: 1 },
        { menu_id: M.gallery, for_website: 1, for_mobile: 1 },
        { menu_id: M.agenda, for_website: 1, for_mobile: 1 },
    ];
    await planService.update(plan.id, { menus: withoutRsvp });
    const resolvedOff = await scanner('POST', '/public/events/qr/resolve', { token: qrToken });
    ok('RSVP off (admin removed RSVP): QR resolve says rsvp_enabled = false',
        resolvedOff.data?.rsvp_enabled === false, JSON.stringify(resolvedOff.data?.rsvp_enabled));

    // A brand-new guest joins while RSVP is off — and the request STILL sends an
    // answer, as an old app build would.
    const guestMobile = `72${stamp}${String(Math.floor(Math.random() * 90) + 10)}`;
    const guestClient = await clientService.create({
        name: `ZZ QA Guest ${stamp}`, email: `zzqa.g.${stamp}@example.com`,
        mobile: guestMobile, dial_code: '+91', password: PASSWORD, is_active: 1,
    });
    const guestApp = session('bearer');
    await guestApp('POST', '/public/website-clients/login/otp/request', { mobile: guestMobile, dial_code: '+91' });
    const guestOtp = await guestApp('POST', '/public/website-clients/login/otp/verify', { mobile: guestMobile, dial_code: '+91', code: '123456', otp: '123456' });
    guestApp.setToken(guestOtp.data?.access_token);

    const joined = await guestApp('POST', '/client/events/join', {
        token: qrToken, name: `ZZ QA Guest ${stamp}`, response_type: 'yes', guest_count: 3,
    });
    ok('new guest joins by QR', [200, 201].includes(joined.status), `${joined.status} ${joined.body?.message}`);
    const [joinedRow] = await q(
        'SELECT response_type, rsvp_status, party_size, responded_at FROM event_guests WHERE event_id = ? AND participant_client_id = ? AND deleted_at IS NULL',
        [event.id, guestClient.id],
    );
    ok('RSVP off: the "yes" + 3 guests sent with join are NOT stored (none / invited / party 1)',
        joinedRow && joinedRow.response_type === 'none' && joinedRow.rsvp_status === 'invited'
        && Number(joinedRow.party_size) === 1 && !joinedRow.responded_at,
        JSON.stringify(joinedRow));

    const tabOff = await guestApp('GET', `/client/events/${event.id}/my-rsvp`);
    ok('RSVP off: RSVP tab reports rsvp_enabled false, can_respond false',
        tabOff.data?.rsvp_enabled === false && tabOff.data?.can_respond === false, JSON.stringify(tabOff.data));
    const submitOff = await guestApp('POST', `/client/events/${event.id}/my-rsvp`, { response_type: 'yes', party_size: 2 });
    ok('RSVP off: submitting from the RSVP tab -> 400', submitOff.status === 400, `${submitOff.status} ${submitOff.body?.message}`);

    // Admin adds RSVP back — the guest who joined meanwhile can now answer, once.
    await planService.update(plan.id, { menus: [...withoutRsvp, { menu_id: M.rsvp, for_website: 1, for_mobile: 1 }] });
    const tabOn = await guestApp('GET', `/client/events/${event.id}/my-rsvp`);
    ok('RSVP back on: RSVP tab lets the guest respond',
        tabOn.data?.rsvp_enabled === true && tabOn.data?.can_respond === true, JSON.stringify(tabOn.data));
    const submitOn = await guestApp('POST', `/client/events/${event.id}/my-rsvp`, { response_type: 'yes', party_size: 2 });
    ok('RSVP back on: guest answers from the RSVP tab -> 200', submitOn.status === 200, `${submitOn.status} ${submitOn.body?.message}`);

    // ══ 7. App features follow the PLAN, not the event ═════════════════════
    // Chat is an 'app' menu (apply-app-feature-menus.js). The event never lists
    // it in menu_ids; granting it on mobile is enough for the app to show it,
    // and the portal never sees it as an event menu.
    console.log('\n── 7. app features (plan-only, mobile) ─────────────');
    const [chatRow] = await q("SELECT id FROM event_menus WHERE slug = 'chat' AND menu_group = 'app' AND deleted_at IS NULL");
    if (!chatRow) {
        gap('app feature menus exist (run apply-app-feature-menus.js --apply)', false);
    } else {
        const planNow = [...withoutRsvp, { menu_id: M.rsvp, for_website: 1, for_mobile: 1 }];
        const appBefore = await app('GET', `/client/events/${event.id}`);
        ok('plan without Chat: app event menus have no chat',
            !(appBefore.data?.event?.menus || []).some((m) => m.slug === 'chat'));

        await planService.update(plan.id, { menus: [...planNow, { menu_id: chatRow.id, for_website: 0, for_mobile: 1 }] });
        const appAfter = await app('GET', `/client/events/${event.id}`);
        const webAfter = await portal('GET', `/client/events/${event.id}`);
        const webOptsAfter = await portal('GET', '/client/event-options');
        ok('plan grants Chat on mobile: app event shows chat (event menu_ids unchanged)',
            (appAfter.data?.event?.menus || []).some((m) => m.slug === 'chat')
            && !(appAfter.data?.event?.menu_ids || []).map(Number).includes(Number(chatRow.id)),
            JSON.stringify((appAfter.data?.event?.menus || []).map((m) => m.slug)));
        ok('portal event menus do NOT include the app feature',
            !(webAfter.data?.event?.menus || []).some((m) => m.slug === 'chat'));
        ok('wizard (event-options) does NOT offer the app feature',
            !(webOptsAfter.data?.menus || []).some((m) => m.slug === 'chat'));
    }

    // ══ Summary ═════════════════════════════════════════════════════════════
    console.log(`\n${pass} passed, ${fail} failed, ${gaps.length} gap(s)`);
    gaps.forEach((g) => console.log(`  - GAP: ${g}`));
    console.log('\nTest data kept for manual checks:');
    console.log(`  portal login   ${email} / ${PASSWORD}   (http://localhost:3005)`);
    console.log(`  app login      +91 ${mobile}   (any OTP — OTP_ACCEPT_ANY)`);
    console.log(`  plan ${plan.id}  client ${client.id}  event ${event.id}`);
    console.log('  remove with:   node tests/plan-menu-gating.test.js --cleanup\n');
    process.exitCode = fail ? 1 : 0;
})()
    .catch((err) => { console.error('\nFAILED:', err.message); process.exitCode = 1; })
    .finally(() => db.sequelize.close());
