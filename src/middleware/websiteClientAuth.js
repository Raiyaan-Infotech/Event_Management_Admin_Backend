const {
    verifyAccessToken,
    verifyRefreshToken,
    generateWebsiteClientAccessToken,
} = require('../utils/jwt');
const { WebsiteClient } = require('../models');
const sessionService = require('../services/clientSession.service');

/**
 * Authenticates a **website client** — someone who signed up on a tenant public
 * site (`website_clients`) and is now in the client portal.
 *
 * NOT the same as `isClientAuthenticated`, which authenticates `vendor_clients`
 * for the older Client Portal. Different table, different token `type`,
 * different cookie names, so both portals can be open in one browser without
 * one session being mistaken for the other.
 */

const COOKIE_ACCESS = 'website_client_access_token';
const COOKIE_REFRESH = 'website_client_refresh_token';
/** "Trust this device for 30 days" — outlives any one session; see jwt.js. */
const COOKIE_DEVICE_TRUST = 'website_client_device_trust';

const cookieOptions = (maxAge) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // The portal is on a different origin from the API, so a cross-site cookie
    // needs SameSite=None in production. 'lax' locally, where both are
    // localhost and 'none' would require HTTPS.
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge,
});

const setWebsiteClientCookies = (res, accessToken, refreshToken) => {
    res.cookie(COOKIE_ACCESS, accessToken, cookieOptions(15 * 60 * 1000));
    if (refreshToken) res.cookie(COOKIE_REFRESH, refreshToken, cookieOptions(7 * 24 * 60 * 60 * 1000));
};

const clearWebsiteClientCookies = (res) => {
    res.clearCookie(COOKIE_ACCESS);
    res.clearCookie(COOKIE_REFRESH);
};

/**
 * Set once, when "Trust this device" is checked — at 2FA enrolment or at the
 * login challenge. Deliberately NOT cleared by `clearWebsiteClientCookies`:
 * logging out ends the SESSION, not the browser's standing trust, the same way
 * "remember this computer" survives a logout on most products that offer it.
 */
const setDeviceTrustCookie = (res, token) => {
    res.cookie(COOKIE_DEVICE_TRUST, token, cookieOptions(30 * 24 * 60 * 60 * 1000));
};

const clearDeviceTrustCookie = (res) => {
    res.clearCookie(COOKIE_DEVICE_TRUST);
};

/**
 * The access token, from whichever transport the caller has.
 *
 * `Authorization: Bearer` FIRST, because that is the only one a mobile app can
 * use — it is not a browser, has no cookie jar, and keeps its tokens in the
 * device keystore. The web portal keeps sending cookies and is unaffected.
 *
 * Header wins when both are present: a native client that explicitly attached a
 * token means that token, and silently preferring a stale cookie from some
 * other session would be very hard to diagnose.
 */
const bearerToken = (req) => {
    const header = req.get('authorization') || req.get('Authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : null;
};

const isWebsiteClientAuthenticated = async (req, res, next) => {
    try {
        const headerToken = bearerToken(req);
        const accessToken = headerToken || req.cookies[COOKIE_ACCESS];
        const refreshToken = req.cookies[COOKIE_REFRESH];

        let decoded = accessToken ? verifyAccessToken(accessToken) : null;

        // Access token expired — mint a new one from the refresh token so a
        // 15-minute session does not interrupt someone mid-form.
        //
        // Cookie callers only. A bearer caller has nowhere to receive a rotated
        // token — a Set-Cookie on a native HTTP client goes nowhere — so it gets
        // a 401 and refreshes explicitly through
        // POST /public/website-clients/token/refresh, which hands the new pair
        // back in the body where the app can actually store it.
        if ((!decoded || decoded.type !== 'website_client') && refreshToken && !headerToken) {
            const refreshDecoded = verifyRefreshToken(refreshToken);
            if (refreshDecoded && refreshDecoded.type === 'website_client') {
                /*
                  The refresh token's `jti` IS the session. Check it is still
                  live before minting anything: without this, "Log out this
                  device" would be undone by that device's very next request.

                  The refresh cookie is deliberately NOT rotated here. A browser
                  fires several requests at once, and single-use rotation would
                  have all but one of them lose the race and get signed out.
                  Rotation belongs to the explicit /token/refresh endpoint, which
                  the app calls one request at a time.
                */
                const live = await sessionService.findLiveSession(refreshDecoded.jti);
                const fresh = live?.client
                    ?? (refreshDecoded.jti ? null : await WebsiteClient.findByPk(refreshDecoded.id));
                if (fresh) {
                    const newAccess = generateWebsiteClientAccessToken(fresh, live?.jti ?? null);
                    res.cookie(COOKIE_ACCESS, newAccess, cookieOptions(15 * 60 * 1000));
                    decoded = verifyAccessToken(newAccess);
                }
            }
        }

        if (!decoded || decoded.type !== 'website_client') {
            // Only a cookie caller has cookies to clear. Doing it unconditionally
            // would let an app request with a stale bearer token sign out a
            // browser session sharing the same connection.
            if (!headerToken) clearWebsiteClientCookies(res);
            return res.status(401).json({ success: false, message: 'Client authentication required.' });
        }

        /*
          Re-read every request rather than trusting the token's payload: an
          admin can deactivate or delete a client at any time, and a 15-minute
          token would otherwise keep working until it expired.

          When the token names a session, that read IS the session lookup — one
          query with the client included, not two. Production is roughly 374ms
          per round trip, so a second query would double the cost of every
          authenticated request.
        */
        let session = null;
        let client;

        if (decoded.sid) {
            session = await sessionService.findLiveSession(decoded.sid);
            if (!session) {
                // Revoked, or past its 7 days. This is the path that makes
                // "Log Out" on another device mean something within 15 minutes.
                if (!headerToken) clearWebsiteClientCookies(res);
                return res.status(401).json({
                    success: false,
                    message: 'This session was signed out. Please sign in again.',
                });
            }
            client = session.client;
        } else {
            /*
              ⚠ GRACE PATH. Tokens minted before sessions existed carry no `sid`.
              Rejecting them would sign every signed-in client out at the moment
              this deploys. They keep working until they expire — at most 7 days —
              and everything issued from now on is session-backed.
            */
            client = await WebsiteClient.findByPk(decoded.id);
        }

        if (!client) {
            if (!headerToken) clearWebsiteClientCookies(res);
            return res.status(401).json({ success: false, message: 'Your account no longer exists.' });
        }
        if (Number(client.is_active) !== 1) {
            if (!headerToken) clearWebsiteClientCookies(res);
            return res.status(403).json({ success: false, message: 'Your account is not active. Please contact us.' });
        }

        if (session) {
            // Fire-and-forget, and throttled to once every five minutes inside
            // the service: "last active" only has to be roughly right, and a
            // write on every request is a write nobody reads.
            sessionService.touchSession(session).catch(() => {});
        }

        req.clientSession = session;
        req.sessionJti = decoded.sid ?? null;
        req.websiteClient = client;
        // Scope every downstream query to this client's company, the same way
        // extractCompanyContext does for admins.
        req.companyId = client.company_id ?? null;
        next();
    } catch {
        clearWebsiteClientCookies(res);
        return res.status(401).json({ success: false, message: 'Client authentication required.' });
    }
};

module.exports = {
    isWebsiteClientAuthenticated,
    setWebsiteClientCookies,
    clearWebsiteClientCookies,
    setDeviceTrustCookie,
    clearDeviceTrustCookie,
    COOKIE_DEVICE_TRUST,
};
