const { verifyAccessToken, verifyRefreshToken, generateClientAccessToken, COOKIE_OPTIONS } = require('../utils/jwt');
const { VendorClient, Vendor } = require('../models');

const clearClientCookies = (res) => {
    res.clearCookie('client_access_token', COOKIE_OPTIONS);
    res.clearCookie('client_refresh_token', COOKIE_OPTIONS);
};

const isClientAuthenticated = async (req, res, next) => {
    try {
        const accessToken = req.cookies.client_access_token;
        const refreshToken = req.cookies.client_refresh_token;

        let decoded = null;
        if (accessToken) decoded = verifyAccessToken(accessToken);

        if (!decoded && refreshToken) {
            const refreshDecoded = verifyRefreshToken(refreshToken);
            if (refreshDecoded && refreshDecoded.type === 'client') {
                const clientForRefresh = await VendorClient.findByPk(refreshDecoded.id);
                if (clientForRefresh && clientForRefresh.is_active === 1 && clientForRefresh.login_access === 1) {
                    const newAccessToken = generateClientAccessToken(clientForRefresh);
                    res.cookie('client_access_token', newAccessToken, {
                        ...COOKIE_OPTIONS,
                        maxAge: 15 * 60 * 1000,
                    });
                    decoded = verifyAccessToken(newAccessToken);
                }
            }
        }

        if (!decoded || decoded.type !== 'client') {
            clearClientCookies(res);
            return res.status(401).json({ success: false, message: 'Client authentication required.' });
        }

        const client = await VendorClient.findByPk(decoded.id, {
            include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'status'] }],
        });

        if (!client) {
            clearClientCookies(res);
            return res.status(401).json({ success: false, message: 'Client account not found.' });
        }
        if (client.is_active !== 1) {
            clearClientCookies(res);
            return res.status(403).json({ success: false, message: 'Your account is inactive. Please contact the vendor.' });
        }
        if (client.login_access !== 1) {
            clearClientCookies(res);
            return res.status(403).json({ success: false, message: 'Your login access has been revoked.' });
        }
        if (client.vendor && client.vendor.status !== 'active') {
            clearClientCookies(res);
            return res.status(403).json({ success: false, message: 'Vendor account is suspended. Please contact support.' });
        }

        if (client.password_changed_at && decoded.iat) {
            if (client.password_changed_at.getTime() > decoded.iat * 1000) {
                clearClientCookies(res);
                return res.status(401).json({ success: false, message: 'Your password was changed. Please login again.' });
            }
        }

        req.client = client;
        next();
    } catch (error) {
        clearClientCookies(res);
        return res.status(401).json({ success: false, message: 'Client authentication required.' });
    }
};

module.exports = { isClientAuthenticated };
