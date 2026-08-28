const {
    verifyAccessToken,
    verifyRefreshToken,
    generateWebsiteClientAccessToken,
} = require('../utils/jwt');
const { WebsiteClient } = require('../models');

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
                const fresh = await WebsiteClient.findByPk(refreshDecoded.id);
                if (fresh) {
                    const newAccess = generateWebsiteClientAccessToken(fresh);
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

        // Re-read every request rather than trusting the token's payload: an
        // admin can deactivate or delete a client at any time, and a 15-minute
        // token would otherwise keep working until it expired.
        const client = await WebsiteClient.findByPk(decoded.id);
        if (!client) {
            if (!headerToken) clearWebsiteClientCookies(res);
            return res.status(401).json({ success: false, message: 'Your account no longer exists.' });
        }
        if (Number(client.is_active) !== 1) {
            if (!headerToken) clearWebsiteClientCookies(res);
            return res.status(403).json({ success: false, message: 'Your account is not active. Please contact us.' });
        }

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
};
