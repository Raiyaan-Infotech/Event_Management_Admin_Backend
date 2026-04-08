const vendorStaffAuthService = require('../services/vendorStaffAuth.service');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const { generateStaffAccessToken, generateStaffRefreshToken, COOKIE_OPTIONS } = require('../utils/jwt');

const STAFF_COOKIE_OPTIONS = {
    ...COOKIE_OPTIONS,
};

/**
 * POST /api/v1/vendors/staff/auth/login
 */
const staffLogin = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) throw ApiError.badRequest('Email and password are required');

    const staff = await vendorStaffAuthService.login(email, password);

    const accessToken  = generateStaffAccessToken(staff);
    const refreshToken = generateStaffRefreshToken(staff);

    res.cookie('staff_access_token', accessToken, {
        ...STAFF_COOKIE_OPTIONS,
        maxAge: 15 * 60 * 1000, // 15 minutes
    });
    res.cookie('staff_refresh_token', refreshToken, {
        ...STAFF_COOKIE_OPTIONS,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    ApiResponse.success(res, { staff: staff.toJSON() }, 'Login successful');
});

/**
 * POST /api/v1/vendors/staff/auth/logout
 */
const staffLogout = asyncHandler(async (req, res) => {
    res.clearCookie('staff_access_token', STAFF_COOKIE_OPTIONS);
    res.clearCookie('staff_refresh_token', STAFF_COOKIE_OPTIONS);
    ApiResponse.success(res, null, 'Logged out successfully');
});

/**
 * GET /api/v1/vendors/staff/auth/me
 */
const staffMe = asyncHandler(async (req, res) => {
    const staff = await vendorStaffAuthService.getProfile(req.staff.id);
    ApiResponse.success(res, { staff: staff.toJSON() }, 'Profile retrieved successfully');
});

/**
 * POST /api/v1/vendors/staff/auth/forgot-password
 */
const staffForgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) throw ApiError.badRequest('Email is required');

    const result = await vendorStaffAuthService.forgotPassword(email);
    ApiResponse.success(res, null, result.message);
});

/**
 * POST /api/v1/vendors/staff/auth/verify-reset-otp
 */
const staffVerifyResetOTP = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) throw ApiError.badRequest('Email and OTP are required');

    const result = await vendorStaffAuthService.verifyResetOTP(email, otp);
    ApiResponse.success(res, null, result.message);
});

/**
 * POST /api/v1/vendors/staff/auth/reset-password
 */
const staffResetPassword = asyncHandler(async (req, res) => {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password) throw ApiError.badRequest('Email, OTP, and new password are required');

    const result = await vendorStaffAuthService.resetPassword(email, otp, password);
    ApiResponse.success(res, null, result.message);
});

/**
 * PUT /api/v1/vendors/staff/auth/change-password
 */
const staffChangePassword = asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) throw ApiError.badRequest('Current and new password are required');

    await vendorStaffAuthService.changePassword(req.staff.id, current_password, new_password);
    ApiResponse.success(res, null, 'Password changed successfully');
});

module.exports = {
    staffLogin,
    staffLogout,
    staffMe,
    staffForgotPassword,
    staffVerifyResetOTP,
    staffResetPassword,
    staffChangePassword,
};
