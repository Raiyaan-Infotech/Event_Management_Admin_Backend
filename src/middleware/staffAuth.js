const { verifyAccessToken, verifyRefreshToken, generateStaffAccessToken, COOKIE_OPTIONS } = require('../utils/jwt');
const { VendorStaff } = require('../models');

const isStaffAuthenticated = async (req, res, next) => {
    try {
        const accessToken  = req.cookies.staff_access_token;
        const refreshToken = req.cookies.staff_refresh_token;

        let decoded = null;

        if (accessToken) {
            decoded = verifyAccessToken(accessToken);
        }

        // Access token missing/expired — try refresh token
        if (!decoded && refreshToken) {
            const refreshDecoded = verifyRefreshToken(refreshToken);
            if (refreshDecoded && refreshDecoded.type === 'staff') {
                // Fetch staff to regenerate access token with fresh data
                const staffForRefresh = await VendorStaff.findByPk(refreshDecoded.id);
                if (staffForRefresh && staffForRefresh.is_active === 1 && staffForRefresh.login_access) {
                    const newAccessToken = generateStaffAccessToken(staffForRefresh);
                    res.cookie('staff_access_token', newAccessToken, {
                        ...COOKIE_OPTIONS,
                        maxAge: 15 * 60 * 1000,
                    });
                    decoded = verifyAccessToken(newAccessToken);
                }
            }
        }

        if (!decoded || decoded.type !== 'staff') {
            return res.status(401).json({ success: false, message: 'Staff authentication required.' });
        }

        const staff = await VendorStaff.findByPk(decoded.id);

        if (!staff) {
            return res.status(401).json({ success: false, message: 'Staff account not found.' });
        }

        if (staff.is_active !== 1) {
            return res.status(403).json({ success: false, message: 'Your account is inactive. Please contact your vendor.' });
        }

        if (!staff.login_access) {
            return res.status(403).json({ success: false, message: 'Your login access has been revoked.' });
        }

        req.staff = staff;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Staff authentication required.' });
    }
};

module.exports = { isStaffAuthenticated };
