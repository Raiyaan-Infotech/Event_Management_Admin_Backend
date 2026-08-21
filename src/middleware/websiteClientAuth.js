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

const isWebsiteClientAuthenticated = async (req, res, next) => {
    try {
        const accessToken = req.cookies[COOKIE_ACCESS];
        const refreshToken = req.cookies[COOKIE_REFRESH];

        let decoded = accessToken ? verifyAccessToken(accessToken) : null;

        // Access token expired — mint a new one from the refresh token so a
        // 15-minute session does not interrupt someone mid-form.
        if ((!decoded || decoded.type !== 'website_client') && refreshToken) {
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
            clearWebsiteClientCookies(res);
            return res.status(401).json({ success: false, message: 'Client authentication required.' });
        }

        // Re-read every request rather than trusting the token's payload: an
        // admin can deactivate or delete a client at any time, and a 15-minute
        // token would otherwise keep working until it expired.
        const client = await WebsiteClient.findByPk(decoded.id);
        if (!client) {
            clearWebsiteClientCookies(res);
            return res.status(401).json({ success: false, message: 'Your account no longer exists.' });
        }
        if (Number(client.is_active) !== 1) {
            clearWebsiteClientCookies(res);
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
