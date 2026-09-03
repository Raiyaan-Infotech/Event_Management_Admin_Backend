/*
 * The 2FA login challenge — end to end, in-process via supertest.
 *
 * ── WHY SUPERTEST HERE AND NOT `node -e` ────────────────────────────────────
 * This flow spans TWO requests that must share cookies (login, then the 2FA
 * verify) and the middleware's own request/response cycle — exactly what a raw
 * service call cannot exercise. `supertest` drives the real Express app
 * in-process on an ephemeral port that closes when the test does; it is not a
 * long-running dev server.
 *
 * ── IT RESTORES WHATEVER WAS REALLY THERE, NOT JUST "CLEAN" ─────────────────
 * `test@example.com` is also the seeded account used for manual, interactive
 * testing — a real phone scanning a real QR code. This test used to wipe that
 * account's 2FA secret, backup codes and sessions unconditionally as "clean
 * slate" / "cleanup"; re-running it while someone had 2FA enrolled in a
 * browser deleted their enrollment mid-session, and the next login attempt
 * failed with a confusing "wrong code" instead of the real reason. It now
 * snapshots whatever is really there first and restores it exactly (see
 * helpers/security-snapshot.js), inside a `finally` so a failed assertion
 * midway still leaves the account as it found it.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-2fa-login.test.js
 * Needs the local database. Does NOT need a server already running.
 */
require('dotenv').config();

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/models');
const twoFactor = require('../src/services/clientTwoFactor.service');
const otp = require('otplib');
const { snapshotClientSecurity, restoreClientSecurity } = require('./helpers/security-snapshot');

let passed = 0;
let failed = 0;
const check = (label, cond) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
    if (cond) passed += 1; else failed += 1;
};

/** Pull one Set-Cookie value's `name=value` pair back out for the next request. */
const cookieFrom = (setCookieHeader, name) => {
    const line = (setCookieHeader || []).find((c) => c.startsWith(`${name}=`));
    return line ? line.split(';')[0] : null;
};

const CREDENTIALS = { email: 'test@example.com', password: 'Test@123' };

(async () => {
    const client = await db.WebsiteClient.findOne({ where: { email: CREDENTIALS.email } });
    if (!client) throw new Error(`Seeded test client ${CREDENTIALS.email} not found.`);

    const before = await snapshotClientSecurity(db, client.id);

    try {
    // Clean slate.
    await db.ClientSession.destroy({ where: { website_client_id: client.id } });
    await db.ClientTwoFactor.destroy({ where: { website_client_id: client.id } });
    await db.ClientBackupCode.destroy({ where: { website_client_id: client.id } });

    console.log(`\nAgainst ${CREDENTIALS.email} (id ${client.id})\n`);

    /* ── Before 2FA: login is unchanged ─────────────────────────────────── */
    const plainLogin = await request(app)
        .post('/api/v1/public/website-clients/login')
        .send(CREDENTIALS);
    check('login with no 2FA returns a real session, not a challenge',
        plainLogin.body?.data?.requires_2fa !== true && plainLogin.status === 200);
    check('...and sets the session cookie',
        Boolean(cookieFrom(plainLogin.headers['set-cookie'], 'website_client_access_token')));

    /* ── Enrol 2FA ───────────────────────────────────────────────────────── */
    const setup = await twoFactor.beginSetup(client);
    const firstCode = otp.generateSync({ secret: setup.secret });
    const { codes } = await twoFactor.confirmSetup(client, firstCode);

    /* ── Now login demands a challenge ──────────────────────────────────── */
    const gated = await request(app)
        .post('/api/v1/public/website-clients/login')
        .send(CREDENTIALS);
    check('login with 2FA on returns a challenge, not a session',
        gated.body?.data?.requires_2fa === true);
    check('...with no session cookie set',
        !cookieFrom(gated.headers['set-cookie'], 'website_client_access_token'));

    const challengeToken = gated.body.data.challenge_token;
    check('...and a usable challenge token', typeof challengeToken === 'string' && challengeToken.length > 0);

    /* ── Wrong code is refused ──────────────────────────────────────────── */
    const wrongCode = await request(app)
        .post('/api/v1/public/website-clients/login/2fa/verify')
        .send({ challenge_token: challengeToken, code: '000000' });
    check('a wrong code at the challenge is refused', wrongCode.status === 401);

    /*
      Right code opens a real session, with device trust.

      MUST differ from `firstCode`, which `confirmSetup` above already
      consumed and recorded against `last_used_counter` — generating "the
      current code" again here can land in that same 30-second window and get
      correctly rejected as a replay, which is not what this assertion is
      testing. `epoch` (in SECONDS — otplib's own unit) one period ahead
      produces a genuinely different, still-verifiable code deterministically,
      with no real waiting and no flake.
    */
    const nextCode = otp.generateSync({
        secret: setup.secret,
        epoch: Math.floor(Date.now() / 1000) + 30,
    });
    const verified = await request(app)
        .post('/api/v1/public/website-clients/login/2fa/verify')
        .send({ challenge_token: challengeToken, code: nextCode, trust_device: true });

    check('the right code opens a real session', verified.status === 200);
    check('...with a session cookie',
        Boolean(cookieFrom(verified.headers['set-cookie'], 'website_client_access_token')));
    const trustCookie = cookieFrom(verified.headers['set-cookie'], 'website_client_device_trust');
    check('...and a device-trust cookie, since trust_device was true', Boolean(trustCookie));

    /* ── That challenge token is now spent — cannot be replayed ──────────── */
    const replay = await request(app)
        .post('/api/v1/public/website-clients/login/2fa/verify')
        .send({ challenge_token: challengeToken, code: nextCode });
    check('the SAME code cannot verify the challenge twice', replay.status === 401);

    /* ── Trusted device skips the challenge on the NEXT login ───────────── */
    const trustedLogin = await request(app)
        .post('/api/v1/public/website-clients/login')
        .set('Cookie', trustCookie)
        .send(CREDENTIALS);
    check('a trusted device is not challenged again',
        trustedLogin.body?.data?.requires_2fa !== true && trustedLogin.status === 200);

    /* ── Disabling 2FA invalidates the trust cookie ──────────────────────── */
    await twoFactor.disable(client, { code: codes[1] });
    const afterDisable = await request(app)
        .post('/api/v1/public/website-clients/login')
        .set('Cookie', trustCookie)
        .send(CREDENTIALS);
    check('login is a normal session once 2FA is off, trust cookie or not',
        afterDisable.body?.data?.requires_2fa !== true && afterDisable.status === 200);

    // Re-enrolling gives a NEW confirmed_at, so the OLD trust cookie must no
    // longer match even though 2FA is on again.
    const setup2 = await twoFactor.beginSetup(client);
    await twoFactor.confirmSetup(client, otp.generateSync({ secret: setup2.secret }));
    const afterReenrol = await request(app)
        .post('/api/v1/public/website-clients/login')
        .set('Cookie', trustCookie)
        .send(CREDENTIALS);
    check('re-enrolling 2FA invalidates the old trust cookie',
        afterReenrol.body?.data?.requires_2fa === true);

    } finally {
        /* ── Restore whatever was really there before this test touched it ── */
        await restoreClientSecurity(db, client.id, before);
    }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    await db.sequelize.close();
    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n', err.stack);
    process.exit(1);
});
