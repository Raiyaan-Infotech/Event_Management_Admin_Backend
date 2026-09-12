/**
 * Response-time check for every endpoint the MOBILE APP calls.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The app is a guest-facing event app: someone opens an invitation at the venue
 * on a phone, and a screen that takes two seconds reads as broken. "Is the
 * backend fast enough" is not a question to answer by feel, so this measures it
 * the way the app experiences it — signed in as a real website client, over
 * HTTP, one endpoint at a time.
 *
 * Run it against the live LOCAL server (nothing is started for you):
 *   node tests/perf-client-api.js
 * Against production (cold start is part of the result — see the note below):
 *   BASE_URL=https://event-management-admin-backend.onrender.com/api/v1 \
 *     node tests/perf-client-api.js
 * As a particular account, with a particular event:
 *   MOBILE=7017197713 EVENT_ID=60 node tests/perf-client-api.js
 *
 * ── IT SIGNS IN WITH AN OTP, SO IT NEEDS A DEV ECHO ──────────────────────────
 * Nothing delivers SMS yet. The server echoes the code in the response on a
 * non-production build, and that echo is what this uses. Against a server that
 * does NOT echo, pass a token instead: TOKEN=<access token>.
 *
 * ── READING THE NUMBERS ──────────────────────────────────────────────────────
 * Locally every query is sub-millisecond, so local timings measure the CODE.
 * Production adds ~200-374ms per database round trip (Render → Aiven), which is
 * why the count of round trips per request matters far more than anything else:
 * to count them for one endpoint, take `SHOW GLOBAL STATUS LIKE 'Questions'`
 * before and after a single call on an otherwise idle database.
 *
 * Render also SLEEPS an idle instance. The first request after that can take
 * 30s+ — and the app's own receiveTimeout is 20s, so it gives up first. A cold
 * first number here is the instance waking, not the endpoint being slow; the
 * run prints it separately for that reason.
 */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5001/api/v1';
const MOBILE = process.env.MOBILE || '7017197713';
const EVENT_ID = process.env.EVENT_ID || null;
const RUNS = Number(process.env.RUNS || 7);
/** Anything slower than this on one request is called out. */
const SLOW_MS = Number(process.env.SLOW_MS || 400);

const ms = (n) => `${n.toFixed(0)}ms`.padStart(7);

const timed = async (url, options) => {
    const started = process.hrtime.bigint();
    const res = await fetch(url, options);
    const body = await res.text();
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    return { status: res.status, body, elapsed };
};

const json = (body) => {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
};

const median = (list) => {
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Signs in the way the app does: request a code, read the dev echo, verify. */
const signIn = async () => {
    if (process.env.TOKEN) return process.env.TOKEN;

    const request = await timed(`${BASE_URL}/public/website-clients/login/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: MOBILE }),
    });
    const code = json(request.body)?.data?.dev_code;
    console.log(`login  otp/request   ${ms(request.elapsed)}  ${request.status}`);
    if (!code) {
        throw new Error(
            `No dev_code in the OTP response — this server does not echo codes. `
            + `Pass TOKEN=<access token> instead. Server said: ${request.body.slice(0, 200)}`
        );
    }

    const verify = await timed(`${BASE_URL}/public/website-clients/login/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: MOBILE, otp: code }),
    });
    console.log(`login  otp/verify    ${ms(verify.elapsed)}  ${verify.status}`);
    const token = json(verify.body)?.data?.access_token;
    if (!token) throw new Error(`Sign-in failed: ${verify.body.slice(0, 200)}`);
    return token;
};

const main = async () => {
    console.log(`\nBASE_URL ${BASE_URL}`);
    console.log(`client   ${MOBILE}   runs ${RUNS} per endpoint\n`);

    const token = await signIn();
    // `x-client: flutter` is EXACTLY what the app sends, and it is what gates
    // the app's menus (`platformFromHeader`: only the literal string 'flutter'
    // means mobile — 'mobile' itself falls through to the website payload). Get
    // this wrong and the script measures the portal, not the app.
    const headers = { Authorization: `Bearer ${token}`, 'x-client': 'flutter' };

    // The event to read. Whatever this account can actually open, so the script
    // works on any database rather than only the one it was written against.
    let eventId = EVENT_ID;
    if (!eventId) {
        const owned = json((await timed(`${BASE_URL}/client/events`, { headers })).body);
        const joined = json((await timed(`${BASE_URL}/client/events/joined`, { headers })).body);
        eventId = owned?.data?.[0]?.id ?? joined?.data?.events?.[0]?.id ?? null;
    }
    if (!eventId) console.log('⚠ no event found for this account — event-scoped rows are skipped\n');

    const endpoints = [
        ['app launch', '/client/me'],
        ['home', '/client/events'],
        ['home', '/client/events/joined'],
        ['home', '/client/notifications/count'],
        ['dashboard', '/client/events/stats'],
        ['create event', '/client/event-options'],
        ['notifications', '/client/notifications'],
        ...(eventId
            ? [
                ['event open', `/client/events/${eventId}`],
                ['event open', `/client/splash-screens/for-event/${eventId}`],
                ['rsvp', `/client/events/${eventId}/my-rsvp`],
                ['guests', `/client/guests?event_id=${eventId}`],
            ]
            : []),
    ];

    console.log('screen          endpoint                                    first   median      max  status  bytes');
    const slow = [];
    for (const [screen, path] of endpoints) {
        const times = [];
        let status = 0;
        let bytes = 0;
        for (let i = 0; i < RUNS; i += 1) {
            const res = await timed(`${BASE_URL}${path}`, { headers });
            times.push(res.elapsed);
            status = res.status;
            bytes = Buffer.byteLength(res.body);
        }
        const mid = median(times.slice(1).length ? times.slice(1) : times);
        const worst = Math.max(...times);
        console.log(
            `${screen.padEnd(15)} ${path.padEnd(42)} ${ms(times[0])} ${ms(mid)} ${ms(worst)}`
            + `   ${String(status).padEnd(5)} ${String(bytes).padStart(6)}`
        );
        if (mid > SLOW_MS) slow.push([path, mid]);
    }

    console.log('\n(first = cold; median excludes it)');
    if (slow.length) {
        console.log(`\n⚠ slower than ${SLOW_MS}ms at the median:`);
        for (const [path, mid] of slow) console.log(`   ${ms(mid)}  ${path}`);
    } else {
        console.log(`\n✔ every endpoint under ${SLOW_MS}ms at the median`);
    }
};

main().catch((err) => {
    console.error(`\n✖ ${err.message}`);
    process.exit(1);
});
