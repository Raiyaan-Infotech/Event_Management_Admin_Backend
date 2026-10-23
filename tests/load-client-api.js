/**
 * Load test for the endpoints the MOBILE APP calls.
 *
 * tests/perf-client-api.js answers "how long does ONE user wait". This answers
 * "what happens when many users do it at once" — requests/sec, p50/p95/p99 and
 * errors per endpoint at rising concurrency, plus a whole-app-session scenario
 * (open the app → home → open an event) run by N virtual users together.
 *
 * ── LOCAL ONLY ───────────────────────────────────────────────────────────────
 * It refuses any host that is not localhost, because hammering Render/Aiven
 * would hurt the live app and tells us nothing true (production adds ~374ms per
 * database round trip, so its numbers are network, not code). Start the server
 * yourself first — this script never starts one:
 *   node tests/load-client-api.js
 *
 * Options (env): MOBILE, EVENT_ID, TOKEN, LEVELS="1,10,25", SECONDS=5,
 *   SESSIONS=25 (virtual users in the session scenario), SLOW_MS=400,
 *   REPORT=1 (also write qa-reports/<date>-load-report.md).
 *
 * Signing in uses the OTP dev echo, once, and shares the token — so the 30 per
 * 15 min login limiter is never touched. Only GET endpoints are exercised;
 * nothing is written to the database.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5001/api/v1';
const MOBILE = process.env.MOBILE || '7017197713';
const LEVELS = (process.env.LEVELS || '1,10,25').split(',').map(Number).filter(Boolean);
const SECONDS = Number(process.env.SECONDS || 5);
const SESSIONS = Number(process.env.SESSIONS || 25);
const SLOW_MS = Number(process.env.SLOW_MS || 400);

const host = new URL(BASE_URL).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`✖ Refusing to load-test ${host}. Local servers only (see the header of this file).`);
    process.exit(1);
}

const json = (body) => {
    try { return JSON.parse(body); } catch { return null; }
};

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const fmt = (n) => `${n.toFixed(0)}ms`.padStart(7);

/** One timed request. Never throws: a network failure is a counted error. */
const hit = async (url, headers) => {
    const started = process.hrtime.bigint();
    try {
        const res = await fetch(url, { headers });
        const body = await res.text();
        return { ok: res.status >= 200 && res.status < 300, status: res.status, ms: Number(process.hrtime.bigint() - started) / 1e6, bytes: Buffer.byteLength(body), body };
    } catch (err) {
        return { ok: false, status: 0, ms: Number(process.hrtime.bigint() - started) / 1e6, bytes: 0, body: '', err: err.message };
    }
};

const signIn = async () => {
    if (process.env.TOKEN) return process.env.TOKEN;
    const post = (p, body) => fetch(`${BASE_URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.text());
    const code = json(await post('/public/website-clients/login/otp/request', { mobile: MOBILE }))?.data?.dev_code;
    if (!code) throw new Error('No dev_code in the OTP response — set OTP_DEV_ECHO=true on the local server, or pass TOKEN=<access token>.');
    const token = json(await post('/public/website-clients/login/otp/verify', { mobile: MOBILE, otp: code }))?.data?.access_token;
    if (!token) throw new Error('Sign-in failed.');
    return token;
};

/** `workers` loops hammer one URL for `seconds`; returns the stats. */
const blast = async (url, headers, workers, seconds) => {
    const times = [];
    let errors = 0;
    let total = 0;
    let bytes = 0;
    const statuses = {};
    const stopAt = Date.now() + seconds * 1000;
    await Promise.all(Array.from({ length: workers }, async () => {
        while (Date.now() < stopAt) {
            const r = await hit(url, headers);
            total += 1;
            bytes = r.bytes || bytes;
            statuses[r.status] = (statuses[r.status] || 0) + 1;
            if (r.ok) times.push(r.ms); else errors += 1;
        }
    }));
    times.sort((a, b) => a - b);
    return { total, errors, rps: total / seconds, p50: pct(times, 50), p95: pct(times, 95), p99: pct(times, 99), max: times[times.length - 1] || 0, bytes, statuses };
};

const main = async () => {
    console.log(`\nBASE_URL ${BASE_URL}\nlevels ${LEVELS.join(' / ')} concurrent · ${SECONDS}s each\n`);
    const health = await hit(BASE_URL.replace(/\/api\/v1\/?$/, '') + '/health');
    if (!health.ok) throw new Error(`Server is not answering (${health.err || health.status}). Start it yourself — this script never does.`);

    const token = await signIn();
    const headers = { Authorization: `Bearer ${token}`, 'x-client': 'flutter' };

    let eventId = process.env.EVENT_ID;
    if (!eventId) {
        const owned = json((await hit(`${BASE_URL}/client/events`, headers)).body);
        const joined = json((await hit(`${BASE_URL}/client/events/joined`, headers)).body);
        eventId = owned?.data?.[0]?.id ?? joined?.data?.events?.[0]?.id;
    }
    if (!eventId) console.log('⚠ no event for this account — event-scoped endpoints skipped\n');

    const e = eventId;
    const endpoints = [
        ['app launch', '/client/me'],
        ['home', '/client/events'],
        ['home', '/client/events/joined'],
        ['home', '/client/notifications/count'],
        ['dashboard', '/client/events/stats'],
        ['create event', '/client/event-options'],
        ['notifications', '/client/notifications'],
        ['quick actions', '/client/quick-actions'],
        ...(e ? [
            ['event open', `/client/events/${e}`],
            ['event open', `/client/splash-screens/for-event/${e}`],
            ['rsvp', `/client/events/${e}/my-rsvp`],
            ['guests', `/client/guests?event_id=${e}`],
            ['participants', `/client/events/${e}/participants`],
            ['family', `/client/events/${e}/family-members`],
            ['gallery', `/client/events/${e}/gallery`],
            ['wishes', `/client/events/${e}/wishes`],
            ['live streams', `/client/events/${e}/live-streams`],
            ['social links', `/client/events/${e}/social-links`],
            ['notifications', `/client/events/${e}/notifications`],
        ] : []),
    ];

    const rows = [];
    console.log(`${'endpoint'.padEnd(44)} conc    req/s     p50     p95     p99     max  err  status`);
    for (const [screen, p] of endpoints) {
        for (const c of LEVELS) {
            const r = await blast(`${BASE_URL}${p}`, headers, c, SECONDS);
            rows.push({ screen, path: p, c, ...r });
            const st = Object.entries(r.statuses).map(([k, v]) => `${k}×${v}`).join(' ');
            console.log(`${p.padEnd(44)} ${String(c).padStart(4)} ${r.rps.toFixed(0).padStart(8)} ${fmt(r.p50)} ${fmt(r.p95)} ${fmt(r.p99)} ${fmt(r.max)} ${String(r.errors).padStart(4)}  ${st}`);
        }
    }

    // Whole-app session: N users each open the app the way a phone does.
    const flow = ['/client/me', '/client/events', '/client/events/joined', '/client/notifications/count', '/client/quick-actions', ...(e ? [`/client/events/${e}`, `/client/events/${e}/my-rsvp`] : [])];
    const sessionTimes = [];
    let sessionErrors = 0;
    const t0 = Date.now();
    await Promise.all(Array.from({ length: SESSIONS }, async () => {
        const s = process.hrtime.bigint();
        for (const p of flow) {
            const r = await hit(`${BASE_URL}${p}`, headers);
            if (!r.ok) sessionErrors += 1;
        }
        sessionTimes.push(Number(process.hrtime.bigint() - s) / 1e6);
    }));
    sessionTimes.sort((a, b) => a - b);
    const session = { users: SESSIONS, calls: flow.length, wall: Date.now() - t0, p50: pct(sessionTimes, 50), p95: pct(sessionTimes, 95), max: sessionTimes[sessionTimes.length - 1], errors: sessionErrors };
    console.log(`\nApp session (${flow.length} calls in a row) × ${SESSIONS} users at once: p50 ${fmt(session.p50)}  p95 ${fmt(session.p95)}  max ${fmt(session.max)}  errors ${sessionErrors}`);

    // Slowest first, judged at the highest concurrency.
    const top = Math.max(...LEVELS);
    const ranked = rows.filter((r) => r.c === top).sort((a, b) => b.p95 - a.p95);
    console.log(`\nSlowest at ${top} concurrent (p95):`);
    ranked.slice(0, 8).forEach((r) => console.log(`  ${fmt(r.p95)}  ${r.rps.toFixed(0).padStart(5)} req/s  ${r.bytes.toString().padStart(7)}B  ${r.path}`));
    const flagged = ranked.filter((r) => r.p95 > SLOW_MS || r.errors);
    console.log(flagged.length ? `\n⚠ ${flagged.length} endpoint(s) over ${SLOW_MS}ms p95 or erroring at ${top} concurrent` : `\n✔ all endpoints under ${SLOW_MS}ms p95 at ${top} concurrent, no errors`);

    if (process.env.REPORT) {
        const dir = path.join(__dirname, '..', 'qa-reports');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-load-report.md`);
        const md = [
            `# Load report — ${new Date().toISOString()}`,
            `Local server ${BASE_URL}, ${SECONDS}s per level, levels ${LEVELS.join('/')}.`,
            '', '| endpoint | conc | req/s | p50 | p95 | p99 | max | errors | bytes |', '|---|---|---|---|---|---|---|---|---|',
            ...rows.map((r) => `| ${r.path} | ${r.c} | ${r.rps.toFixed(0)} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.max.toFixed(0)} | ${r.errors} | ${r.bytes} |`),
            '', `**App session** ×${session.users} users, ${session.calls} calls each: p50 ${session.p50.toFixed(0)}ms, p95 ${session.p95.toFixed(0)}ms, max ${session.max.toFixed(0)}ms, errors ${session.errors}.`,
        ].join('\n');
        fs.writeFileSync(file, md);
        console.log(`\nreport → ${file}`);
    }
};

main().catch((err) => {
    console.error(`\n✖ ${err.message}`);
    process.exit(1);
});
