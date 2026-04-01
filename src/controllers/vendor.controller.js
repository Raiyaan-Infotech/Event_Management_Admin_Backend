const vendorService = require('../services/vendor.service');
const activityLogService = require('../services/activityLog.service');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const { generateVendorAccessToken, generateVendorRefreshToken } = require('../utils/jwt');
const { logVendorActivity } = require('../middleware/activityLogger');

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

const getAll = asyncHandler(async (req, res) => {
    const vendors = await vendorService.getAll(req.query, req.companyId);
    ApiResponse.success(res, vendors, 'Vendors retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
    const vendor = await vendorService.getById(req.params.id, req.companyId);
    ApiResponse.success(res, vendor, 'Vendor retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
    const vendor = await vendorService.create(req.body, req.companyId);
    ApiResponse.success(res, vendor, 'Vendor created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const vendor = await vendorService.update(req.params.id, req.body, req.companyId);
    ApiResponse.success(res, vendor, 'Vendor updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const vendor = await vendorService.updateStatus(req.params.id, req.body.status, req.companyId);
    ApiResponse.success(res, vendor, 'Vendor status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    await vendorService.remove(req.params.id, req.companyId);
    ApiResponse.success(res, null, 'Vendor deleted successfully');
});

// ─── Vendor Auth ──────────────────────────────────────────────────────────────

const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw ApiError.badRequest('Email and password are required');
    }

    const vendor = await vendorService.getByEmailWithPassword(email);
    if (!vendor) {
        throw ApiError.unauthorized('Invalid email or password');
    }

    if (vendor.status !== 'active') {
        throw ApiError.forbidden('Your account is inactive. Please contact the administrator.');
    }

    const isValid = await vendor.validatePassword(password);
    if (!isValid) {
        throw ApiError.unauthorized('Invalid email or password');
    }

    const accessToken  = generateVendorAccessToken(vendor);
    const refreshToken = generateVendorRefreshToken(vendor);

    // Use vendor-specific cookie names to not conflict with admin session
    res.cookie('vendor_access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000,
    });
    res.cookie('vendor_refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    logVendorActivity(vendor.id, 'login', 'vendor_auth', `Logged in successfully`, req);
    ApiResponse.success(res, { vendor: vendor.toJSON() }, 'Login successful');
});

const logout = asyncHandler(async (req, res) => {
    if (req.vendor?.id) {
        logVendorActivity(req.vendor.id, 'logout', 'vendor_auth', 'Logged out', req);
    }
    res.clearCookie('vendor_access_token');
    res.clearCookie('vendor_refresh_token');
    ApiResponse.success(res, null, 'Logged out successfully');
});

const me = asyncHandler(async (req, res) => {
    const vendor = await vendorService.getById(req.vendor.id);
    ApiResponse.success(res, vendor, 'Vendor profile retrieved');
});

const updateProfile = asyncHandler(async (req, res) => {
    const vendor = await vendorService.updateProfile(req.vendor.id, req.body);
    logVendorActivity(req.vendor.id, 'update_profile', 'vendor_profile', 'Profile updated successfully', req);
    ApiResponse.success(res, vendor, 'Profile updated successfully');
});

const changePassword = asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
        throw ApiError.badRequest('current_password and new_password are required');
    }
    await vendorService.changePassword(req.vendor.id, current_password, new_password);
    logVendorActivity(req.vendor.id, 'change_password', 'vendor_security', 'Password changed successfully', req);
    ApiResponse.success(res, null, 'Password changed successfully');
});

const getMyActivity = asyncHandler(async (req, res) => {
    const result = await activityLogService.getByVendor(req.vendor.id, req.query);
    ApiResponse.success(res, result, 'Activity logs retrieved');
});

const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) throw ApiError.badRequest('Email is required');
    const result = await vendorService.forgotPassword(email);
    ApiResponse.success(res, null, result.message);
});

const resetPassword = asyncHandler(async (req, res) => {
    const { email, otp, new_password } = req.body;
    if (!email || !otp || !new_password) {
        throw ApiError.badRequest('email, otp, and new_password are required');
    }
    if (new_password.length < 8) {
        throw ApiError.badRequest('Password must be at least 8 characters');
    }
    await vendorService.resetPassword(email, otp, new_password);
    ApiResponse.success(res, null, 'Password reset successfully');
});

module.exports = { getAll, getById, create, update, updateStatus, remove, login, logout, me, updateProfile, changePassword, getMyActivity, forgotPassword, resetPassword };
