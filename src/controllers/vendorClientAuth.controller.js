const vendorClientAuthService = require('../services/vendorClientAuth.service');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const { generateClientAccessToken, generateClientRefreshToken, COOKIE_OPTIONS } = require('../utils/jwt');

const CLIENT_COOKIE_OPTIONS = {
    ...COOKIE_OPTIONS,
};

const clientLogin = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) throw ApiError.badRequest('Email and password are required');

    const client = await vendorClientAuthService.login(email, password);
    const accessToken = generateClientAccessToken(client);
    const refreshToken = generateClientRefreshToken(client);

    res.cookie('client_access_token', accessToken, {
        ...CLIENT_COOKIE_OPTIONS,
        maxAge: 15 * 60 * 1000,
    });
    res.cookie('client_refresh_token', refreshToken, {
        ...CLIENT_COOKIE_OPTIONS,
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    ApiResponse.success(res, { client: client.toJSON() }, 'Login successful');
});

const clientLogout = asyncHandler(async (req, res) => {
    res.clearCookie('client_access_token', CLIENT_COOKIE_OPTIONS);
    res.clearCookie('client_refresh_token', CLIENT_COOKIE_OPTIONS);
    ApiResponse.success(res, null, 'Logged out successfully');
});

const clientMe = asyncHandler(async (req, res) => {
    const client = await vendorClientAuthService.getProfile(req.client.id);
    ApiResponse.success(res, { client: client.toJSON() }, 'Profile retrieved successfully');
});

const updateClientProfile = asyncHandler(async (req, res) => {
    const client = await vendorClientAuthService.updateProfile(req.client.id, req.body);
    ApiResponse.success(res, { client: client.toJSON() }, 'Profile updated successfully');
});

const changeClientPassword = asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) throw ApiError.badRequest('Current and new password are required');

    await vendorClientAuthService.changePassword(req.client.id, current_password, new_password);
    ApiResponse.success(res, null, 'Password changed successfully');
});

const clientForgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) throw ApiError.badRequest('Email is required');
    const { otp } = await vendorClientAuthService.forgotPassword(email);
    // In production send otp via email; for now return it in response so frontend can display it
    ApiResponse.success(res, { reset_code: otp }, 'A reset code has been generated. Use it to set a new password within 15 minutes.');
});

const clientResetPassword = asyncHandler(async (req, res) => {
    const { email, reset_code, new_password } = req.body;
    if (!email || !reset_code || !new_password) throw ApiError.badRequest('Email, reset code and new password are required');
    await vendorClientAuthService.resetPassword(email, reset_code, new_password);
    ApiResponse.success(res, null, 'Password reset successfully. You can now log in.');
});

module.exports = {
    clientLogin,
    clientLogout,
    clientMe,
    updateClientProfile,
    changeClientPassword,
    clientForgotPassword,
    clientResetPassword,
};
