const { verifyAccessToken, verifyRefreshToken, generateStaffAccessToken, COOKIE_OPTIONS } = require('../utils/jwt');
const { VendorStaff, Role, Permission, Vendor } = require('../models');

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

        // Fetch staff with role, permissions, and parent vendor status
        const staff = await VendorStaff.findByPk(decoded.id, {
            include: [
                {
                    model: Role,
                    as: 'role',
                    include: [{ model: Permission, as: 'permissions' }],
                },
                {
                    model: Vendor,
                    as: 'vendor',
                    attributes: ['id', 'status'],
                },
            ],
        });

        if (!staff) {
            return res.status(401).json({ success: false, message: 'Staff account not found.' });
        }

        if (staff.is_active !== 1) {
            return res.status(403).json({ success: false, message: 'Your account is inactive. Please contact your vendor.' });
        }

        if (!staff.login_access) {
            return res.status(403).json({ success: false, message: 'Your login access has been revoked.' });
        }

        if (staff.vendor && staff.vendor.status !== 'active') {
            return res.status(403).json({ success: false, message: 'Your company account is suspended. Please contact support.' });
        }

        req.staff = staff;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Staff authentication required.' });
    }
};

/**
 * Check if staff has specific permission(s)
 * Usage: hasStaffPermission('tasks.view', 'tasks.edit')
 */
const hasStaffPermission = (...permissions) => {
    return (req, res, next) => {
        if (!req.staff) {
            return res.status(401).json({ success: false, message: 'Staff authentication required.' });
        }

        if (!req.staff.role) {
            return res.status(403).json({ success: false, message: 'No role assigned. Please contact your vendor.' });
        }

        const staffPermissions = req.staff.role.permissions?.map(p => p.slug) || [];
        const hasRequired = permissions.some(p => staffPermissions.includes(p));

        if (!hasRequired) {
            return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
        }

        next();
    };
};

module.exports = { isStaffAuthenticated, hasStaffPermission };
