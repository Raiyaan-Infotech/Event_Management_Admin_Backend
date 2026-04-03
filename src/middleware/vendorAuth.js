const { verifyAccessToken, verifyRefreshToken, generateVendorAccessToken } = require('../utils/jwt');
const { Vendor } = require('../models');

const isVendorAuthenticated = async (req, res, next) => {
    try {
        const accessToken  = req.cookies.vendor_access_token;
        const refreshToken = req.cookies.vendor_refresh_token;

        let decoded = null;

        if (accessToken) {
            decoded = verifyAccessToken(accessToken);
        }

        // Access token missing/expired — try refresh token
        if (!decoded && refreshToken) {
            const refreshDecoded = verifyRefreshToken(refreshToken);
            if (refreshDecoded && refreshDecoded.type === 'vendor') {
                const newAccessToken = generateVendorAccessToken({ id: refreshDecoded.id, email: refreshDecoded.email });
                res.cookie('vendor_access_token', newAccessToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                    maxAge: 15 * 60 * 1000,
                });
                decoded = verifyAccessToken(newAccessToken);
            }
        }

        if (!decoded || decoded.type !== 'vendor') {
            return res.status(401).json({ success: false, message: 'Vendor authentication required.' });
        }

        const vendor = await Vendor.findByPk(decoded.id);
        if (!vendor || vendor.status !== 'active') {
            return res.status(403).json({ success: false, message: 'Vendor account is inactive.' });
        }

        req.vendor = vendor;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Vendor authentication required.' });
    }
};

module.exports = { isVendorAuthenticated };
