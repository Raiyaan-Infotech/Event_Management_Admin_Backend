const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const sessionService = require('../services/clientSession.service');
const twoFactorService = require('../services/clientTwoFactor.service');
const { generateDeviceTrustToken } = require('../utils/jwt');
const { setDeviceTrustCookie, clearDeviceTrustCookie } = require('../middleware/websiteClientAuth');

/**
 * The client portal's Security screens — Active Sessions, Authorized Devices
 * and two-factor authentication.
 *
 * Like the rest of `/client/*`, nothing here takes a client id: everything acts
 * on `req.websiteClient`, set by the auth middleware, so no request can be aimed
 * at somebody else's sessions. A session id IS taken, and is matched against the
 * caller's own rows before anything happens to it.
 *
 * `req.sessionJti` is the caller's own session, put there by the middleware. It
 * decides which row is flagged "this device" and which row "log out everything
 * else" spares — worked out once, on the server, rather than by each screen.
 */

/* ── Sessions ────────────────────────────────────────────────────────────── */

const listSessions = asyncHandler(async (req, res) => {
    const sessions = await sessionService.listSessions(req.websiteClient.id, req.sessionJti);
    return ApiResponse.success(res, {
        sessions,
        current_session_id: sessions.find((s) => s.is_current)?.id ?? null,
        /*
          ⚠ Stated by the API, not assumed by the screen. There is no GeoIP
          service here, so every `location` is null; the screen prints the IP
          instead of a city it would have had to invent.
        */
        location_available: false,
        location_note: 'Sign-in locations are not available — no IP-location service is connected, so the IP address is shown instead.',
    }, 'Sessions retrieved');
});

const revokeSession = asyncHandler(async (req, res) => {
    const session = await sessionService.revokeById(req.websiteClient.id, req.params.id, 'revoked');
    logger.logRequest(req, `Client session revoked: ${session.id}`);

    const sessions = await sessionService.listSessions(req.websiteClient.id, req.sessionJti);
    return ApiResponse.success(res, { sessions }, 'Signed out on that device');
});

/**
 * Everything except the one asking.
 *
 * The caller's own session is spared on the SERVER, from its own token, so this
 * cannot be talked into signing the caller out by a screen that passed the wrong
 * id — and so the button behaves the same way whoever calls it.
 */
const revokeOtherSessions = asyncHandler(async (req, res) => {
    const count = await sessionService.revokeAllOthers(
        req.websiteClient.id,
        req.sessionJti,
        'revoked_all',
    );
    logger.logRequest(req, `Client revoked ${count} other sessions`);

    const sessions = await sessionService.listSessions(req.websiteClient.id, req.sessionJti);
    return ApiResponse.success(
        res,
        { sessions, revoked: count },
        count === 1 ? 'Signed out of 1 other session' : `Signed out of ${count} other sessions`,
    );
});

/* ── Devices ─────────────────────────────────────────────────────────────── */

/**
 * The same rows as Active Sessions, read as devices.
 *
 * ONE table on purpose — see the model header. Two would be two copies of "which
 * device is this", and the first symptom of them drifting is a device you
 * removed still being able to sign in.
 */
const listDevices = asyncHandler(async (req, res) => {
    const sessions = await sessionService.listSessions(req.websiteClient.id, req.sessionJti);
    return ApiResponse.success(res, {
        devices: sessions,
        location_available: false,
    }, 'Devices retrieved');
});

/** Removing a device signs it out. There is no state in which it is remembered but not signed in. */
const removeDevice = asyncHandler(async (req, res) => {
    const session = await sessionService.revokeById(req.websiteClient.id, req.params.id, 'revoked');
    logger.logRequest(req, `Client device removed: ${session.id}`);

    const sessions = await sessionService.listSessions(req.websiteClient.id, req.sessionJti);
    return ApiResponse.success(res, { devices: sessions }, 'Device removed');
});

/* ── Two-factor ──────────────────────────────────────────────────────────── */

const getTwoFactor = asyncHandler(async (req, res) => {
    const status = await twoFactorService.getStatus(req.websiteClient);
    return ApiResponse.success(res, status, 'Two-factor status retrieved');
});

/**
 * Step 1 of enrolment: a secret and the `otpauth://` URI its QR encodes.
 *
 * ⚠ 2FA is NOT on when this returns. The QR being drawn is not evidence that
 * anybody scanned it; `confirm` is where a code from the app proves that, and
 * only then is it switched on. Otherwise closing the tab halfway locks somebody
 * out with a secret they never stored.
 */
const setupTwoFactor = asyncHandler(async (req, res) => {
    const setup = await twoFactorService.beginSetup(req.websiteClient);
    logger.logRequest(req, `Client 2FA setup started: ${req.websiteClient.id}`);
    return ApiResponse.success(res, setup, 'Scan the QR code with your authenticator app');
});

/**
 * Step 2: the code proves the QR was scanned. Returns the backup codes, once.
 *
 * "Trust this device for 30 days" is honoured HERE, at the moment 2FA turns
 * on — not only at a later login challenge, which does not exist yet for this
 * browser to have hit. Two things happen: the CURRENT session is flagged
 * trusted (so it shows correctly on Active Sessions / Authorized Devices), and
 * a separate long-lived cookie is set so a future login on this same browser
 * skips the code entirely.
 */
const confirmTwoFactor = asyncHandler(async (req, res) => {
    const result = await twoFactorService.confirmSetup(req.websiteClient, req.body?.code);

    if (req.body?.trust_device) {
        await sessionService.trustCurrentSession(req.clientSession);
        const confirmedAt = await twoFactorService.confirmedAtFor(req.websiteClient.id);
        setDeviceTrustCookie(res, generateDeviceTrustToken(req.websiteClient, confirmedAt));
    }

    logger.logRequest(req, `Client 2FA enabled: ${req.websiteClient.id}`);
    return ApiResponse.success(res, {
        ...result,
        // Said plainly because it is the only time these exist in readable form.
        note: 'Save these now. They are stored hashed and cannot be shown again — you can only generate a new set.',
    }, 'Two-factor authentication is on');
});

const disableTwoFactor = asyncHandler(async (req, res) => {
    const result = await twoFactorService.disable(req.websiteClient, {
        password: req.body?.password,
        code: req.body?.code,
    });
    /*
      This browser's trust cookie stops matching anyway the moment `confirmed_at`
      is gone (deviceTrustMatches has nothing to compare against), but clearing
      it here removes a cookie that would otherwise sit there doing nothing
      until this browser's next login.
    */
    clearDeviceTrustCookie(res);
    logger.logRequest(req, `Client 2FA disabled: ${req.websiteClient.id}`);
    return ApiResponse.success(res, result, 'Two-factor authentication is off');
});

const regenerateBackupCodes = asyncHandler(async (req, res) => {
    const result = await twoFactorService.regenerateBackupCodes(req.websiteClient);
    logger.logRequest(req, `Client 2FA backup codes regenerated: ${req.websiteClient.id}`);
    return ApiResponse.success(res, {
        ...result,
        note: 'Your previous backup codes no longer work.',
    }, 'New backup codes generated');
});

module.exports = {
    listSessions,
    revokeSession,
    revokeOtherSessions,
    listDevices,
    removeDevice,
    getTwoFactor,
    setupTwoFactor,
    confirmTwoFactor,
    disableTwoFactor,
    regenerateBackupCodes,
};
