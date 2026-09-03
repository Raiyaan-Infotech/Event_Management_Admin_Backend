/*
 * Client-portal Security — sessions, devices and 2FA, in-process.
 *
 * ── WHY IN-PROCESS AND NOT OVER HTTP ────────────────────────────────────────
 * Nearly everything worth locking here is a property the HTTP layer cannot show
 * you: that a rotated refresh token is dead, that the SAME six digits are
 * refused the second time, that a backup code is spent exactly once. Those are
 * decided in the services, and racing them through a live server would make the
 * test slower and no more truthful. The HTTP surface for these routes is thin —
 * list, revoke, and the JSON envelope.
 *
 * ── IT RESTORES WHATEVER WAS REALLY THERE, NOT JUST "CLEAN" ─────────────────
 * This account is also the one used for manual, interactive testing — a real
 * phone scanning a real QR code. A prior version of this test unconditionally
 * WIPED the account's sessions, 2FA secret and backup codes as "cleanup",
 * which once deleted someone's actual enrollment mid-session; the next login
 * attempt then failed with a confusing "wrong code" instead of the real
 * reason. It now snapshots whatever is really there first and restores it
 * exactly (see helpers/security-snapshot.js), inside a `finally` so a test
 * failure midway still leaves the account as it found it.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-security.test.js
 * Needs the local database. Does NOT need the server running.
 */
require('dotenv').config();

const db = require('../src/models');
const sessions = require('../src/services/clientSession.service');
const twoFactor = require('../src/services/clientTwoFactor.service');
const otp = require('otplib');
const { verifyRefreshToken, verifyAccessToken } = require('../src/utils/jwt');
const { snapshotClientSecurity, restoreClientSecurity } = require('./helpers/security-snapshot');

let passed = 0;
let failed = 0;

const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`}`);
    if (ok) passed += 1; else failed += 1;
};

/* A browser and an app, as the services see them. */
const WEB_REQ = {
    ip: '203.0.113.9',
    get: (h) => ({
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }[String(h).toLowerCase()]),
};
const APP_REQ = {
    ip: '203.0.113.44',
    get: (h) => ({
        authorization: 'Bearer whatever',
        'x-device-info': 'iPhone 14 · iOS 17.4',
    }[String(h).toLowerCase()]),
};

(async () => {
    const client = await db.WebsiteClient.findOne({ order: [['id', 'ASC']] });
    if (!client) throw new Error('No website_clients row to test against.');
    console.log(`\nAgainst client ${client.id} (${client.email})\n`);

    // ⚠ This account is also the one used for manual, interactive testing —
    // scanning a real QR with a real phone. Snapshot whatever is really there
    // BEFORE wiping anything, and put it back at the end, byte for byte. See
    // helpers/security-snapshot.js for why: this exact test wiped a real
    // enrollment once, and the failure it caused ("wrong code" on a genuinely
    // correct one) was confusing precisely because nothing said 2FA had been
    // silently turned off.
    const before = await snapshotClientSecurity(db, client.id);

    try {
    // Start clean, so a half-finished previous run cannot make this one pass.
    await db.ClientSession.destroy({ where: { website_client_id: client.id } });
    await db.ClientTwoFactor.destroy({ where: { website_client_id: client.id } });
    await db.ClientBackupCode.destroy({ where: { website_client_id: client.id } });

    /* ── Sessions ────────────────────────────────────────────────────────── */
    console.log('Sessions');

    const web = await sessions.issueSession({ client, req: WEB_REQ });
    const app = await sessions.issueSession({ client, req: APP_REQ, trustDevice: true });
    const webJti = verifyRefreshToken(web.refreshToken).jti;
    const appJti = verifyRefreshToken(app.refreshToken).jti;

    check('both sign-ins are listed', (await sessions.listSessions(client.id, null)).length, 2);
    check('access token carries its session id', verifyAccessToken(web.accessToken).sid, webJti);

    const listed = await sessions.listSessions(client.id, webJti);
    const webRow = listed.find((r) => r.transport === 'web');
    const appRow = listed.find((r) => r.transport === 'app');

    check('browser UA becomes a device name', webRow.device_name, 'Windows · Chrome');
    check('the app’s own header is preferred', appRow.device_name, 'iPhone 14 · iOS 17.4');
    check('the caller is flagged as current', webRow.is_current, true);
    check('the other device is not', appRow.is_current, false);
    check('trust is recorded', appRow.is_trusted, true);
    // ⚠ Locked deliberately: there is no GeoIP service, and a city guessed from
    // an IP would be wrong on the one screen where being wrong matters.
    check('location stays null — nothing can fill it', webRow.location, null);

    /* Rotation is single-use. This is what makes a revoked session stay dead. */
    const rotated = await sessions.rotateSession({ jti: webJti, client, req: WEB_REQ });
    const rotatedJti = verifyRefreshToken(rotated.refreshToken).jti;

    check('the rotated token is dead', await sessions.findLiveSession(webJti), null);
    check('its successor is live', Boolean(await sessions.findLiveSession(rotatedJti)), true);
    check('an untrusted session stays untrusted', (await sessions.findLiveSession(rotatedJti)).trusted_until, null);

    let replayRejected = false;
    try { await sessions.rotateSession({ jti: webJti, client, req: WEB_REQ }); } catch { replayRejected = true; }
    check('replaying a spent refresh token is refused', replayRejected, true);

    /*
      Trust belongs to the DEVICE, not to the fifteen-minute token that happened
      to be current. Rotating the trusted app session must carry it across, or
      "trust this device for 30 days" would quietly last until the next refresh.
    */
    const rotatedApp = await sessions.rotateSession({ jti: appJti, client, req: APP_REQ });
    const rotatedAppJti = verifyRefreshToken(rotatedApp.refreshToken).jti;
    check('trust survives rotation',
        Boolean((await sessions.findLiveSession(rotatedAppJti)).trusted_until), true);
    check('the rotated-away session is gone', await sessions.findLiveSession(appJti), null);

    check('revoke-all-others spares the caller', await sessions.revokeAllOthers(client.id, rotatedJti), 1);
    check('...and the caller is still signed in', Boolean(await sessions.findLiveSession(rotatedJti)), true);
    check('...leaving exactly one session', (await sessions.listSessions(client.id, rotatedJti)).length, 1);

    check('a revoked session cannot be found', await sessions.findLiveSession(rotatedAppJti), null);

    /* ── Two-factor ──────────────────────────────────────────────────────── */
    console.log('\nTwo-factor');

    const setup = await twoFactor.beginSetup(client);
    check('the QR is a real otpauth URI', setup.otpauth_url.startsWith('otpauth://totp/'), true);
    check('a secret exists but 2FA is off', (await twoFactor.getStatus(client)).is_enabled, false);
    check('...and is reported as pending', (await twoFactor.getStatus(client)).is_pending, true);

    // The same secret must come back, or an authenticator that already scanned
    // the QR would be generating codes for a secret we had thrown away.
    check('re-opening setup keeps the secret', (await twoFactor.beginSetup(client)).secret, setup.secret);

    const code = otp.generateSync({ secret: setup.secret });
    const { codes } = await twoFactor.confirmSetup(client, code);

    check('confirming issues backup codes', codes.length, twoFactor.BACKUP_CODE_COUNT);
    check('2FA is now on', (await twoFactor.getStatus(client)).is_enabled, true);
    check('the app is honestly reported as uncovered', (await twoFactor.getStatus(client)).covers.mobile_app, false);

    // The replay guard. Without it the same six digits work for a whole minute.
    check('the SAME code cannot be used twice', await twoFactor.verifyForLogin(client.id, code), false);
    check('a wrong code fails', await twoFactor.verifyForLogin(client.id, '000000'), false);

    check('a backup code works', await twoFactor.verifyForLogin(client.id, codes[0]), true);
    check('...exactly once', await twoFactor.verifyForLogin(client.id, codes[0]), false);
    check('dashes and case are presentation only',
        await twoFactor.verifyForLogin(client.id, codes[1].toLowerCase().replace(/-/g, '')), true);
    check('spent codes are counted', (await twoFactor.getStatus(client)).backup_codes_remaining,
        twoFactor.BACKUP_CODE_COUNT - 2);

    // Regenerating invalidates the old set — that is the reason to regenerate.
    const fresh = await twoFactor.regenerateBackupCodes(client);
    check('regenerating replaces every code', await twoFactor.verifyForLogin(client.id, codes[2]), false);
    check('...with ones that work', await twoFactor.verifyForLogin(client.id, fresh.codes[0]), true);

    let refusedWithoutProof = false;
    try { await twoFactor.disable(client, {}); } catch { refusedWithoutProof = true; }
    check('disabling needs proof of identity', refusedWithoutProof, true);

    await twoFactor.disable(client, { code: fresh.codes[1] });
    check('disabling with a backup code works', (await twoFactor.getStatus(client)).is_enabled, false);
    check('...and takes the backup codes with it',
        await db.ClientBackupCode.count({ where: { website_client_id: client.id } }), 0);

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
