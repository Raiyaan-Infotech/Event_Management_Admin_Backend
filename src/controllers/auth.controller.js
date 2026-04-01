const authService = require('../services/auth.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');
const { generateAccessToken, generateRefreshToken, setTokenCookies, clearTokenCookies } = require('../utils/jwt');
const { RefreshToken } = require('../models');

/**
 * Register new user
 * POST /api/v1/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { full_name, email, password, phone } = req.body;

  const user = await authService.register({
    full_name,
    email,
    password,
    phone,
  });

  logger.logRequest(req, 'User registration');
  return ApiResponse.created(res, { user }, 'Registration successful. Please wait for admin approval.');
});

/**
 * Login user
 * POST /api/v1/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await authService.login(email, password, req);

  // Generate JWT tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Store refresh token in DB
  await RefreshToken.create({
    token: refreshToken,
    user_id: user.id,
    ip_address: req.ip,
    user_agent: req.get('User-Agent'),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  // Set as HttpOnly cookies
  setTokenCookies(res, accessToken, refreshToken);

  logger.logRequest(req, 'User login');
  return ApiResponse.success(res, { user }, 'Login successful');
});

/**
 * Logout user
 * POST /api/v1/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id, req);

  // Invalidate refresh token in DB
  const refreshToken = req.cookies.refresh_token;
  if (refreshToken) {
    await RefreshToken.update(
      { is_active: false },
      { where: { token: refreshToken, user_id: req.user.id } }
    );
  }

  // Clear JWT cookies
  clearTokenCookies(res);

  logger.logRequest(req, 'User logout');
  return ApiResponse.success(res, null, 'Logout successful');
});

/**
 * Get current user profile
 * GET /api/v1/auth/me
 */
const me = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  return ApiResponse.success(res, { user });
});

/**
 * Change password
 * PUT /api/v1/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;

  await authService.changePassword(req.user.id, current_password, new_password);

  logger.logRequest(req, 'Password changed');
  return ApiResponse.success(res, null, 'Password changed successfully');
});

/**
 * Update profile
 * PUT /api/v1/auth/update-profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { full_name, phone, avatar, timezone } = req.body;

  const user = await authService.updateProfile(req.user.id, {
    full_name,
    phone,
    avatar,
    timezone,
  });

  logger.logRequest(req, 'Profile updated');
  return ApiResponse.success(res, { user }, 'Profile updated successfully');
});

/**
 * Forgot password - Send OTP
 * POST /api/v1/auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const result = await authService.forgotPassword(email);

  logger.logRequest(req, 'Password reset OTP requested');
  return ApiResponse.success(res, null, result.message);
});

/**
 * Verify OTP for password reset
 * POST /api/v1/auth/verify-reset-otp
 */
const verifyResetOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  const result = await authService.verifyResetOTP(email, otp);

  logger.logRequest(req, 'Password reset OTP verified');
  return ApiResponse.success(res, null, result.message);
});

/**
 * Reset password with OTP
 * POST /api/v1/auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, password } = req.body;

  const result = await authService.resetPassword(email, otp, password);

  logger.logRequest(req, 'Password reset completed');
  return ApiResponse.success(res, null, result.message);
});

module.exports = {
  register,
  login,
  logout,
  me,
  changePassword,
  updateProfile,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
};
