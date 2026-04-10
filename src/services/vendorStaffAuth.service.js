const { VendorStaff, Vendor, Role, Permission } = require('../models');
const ApiError = require('../utils/apiError');
const emailSenderService = require('./emailSender.service');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

/**
 * Staff login — find by email, validate password, check account status
 */
const login = async (email, password) => {
    const staff = await VendorStaff.findOne({
        where: { email },
        attributes: { include: ['password'] },
        include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'company_name', 'status'] }],
    });

    if (!staff) throw ApiError.unauthorized('Invalid email or password');

    const isValid = await staff.validatePassword(password);
    if (!isValid) throw ApiError.unauthorized('Invalid email or password');

    if (staff.is_active !== 1) {
        throw ApiError.forbidden('Your account is inactive. Please contact your vendor.');
    }

    if (!staff.login_access) {
        throw ApiError.forbidden('Your login access has been revoked. Please contact your vendor.');
    }

    if (staff.vendor && staff.vendor.status !== 'active') {
        throw ApiError.forbidden('Your company account is suspended. Please contact support.');
    }

    return staff;
};

/**
 * Get staff profile (for /me endpoint)
 */
const getProfile = async (staffId) => {
    const staff = await VendorStaff.findByPk(staffId, {
        include: [
            { model: Vendor, as: 'vendor', attributes: ['id', 'company_name', 'company_logo', 'status'] },
            {
                model: Role,
                as: 'role',
                include: [{
                    model: Permission,
                    as: 'permissions',
                }],
            },
        ],
    });
    if (!staff) throw ApiError.notFound('Staff member not found');
    return staff;
};

/**
 * Forgot password — generate OTP and send via email
 */
const forgotPassword = async (email) => {
    const staff = await VendorStaff.findOne({
        where: { email },
        attributes: { include: ['password_reset_token', 'password_reset_expires'] },
    });

    // Don't reveal if email exists
    if (!staff) return { success: true, message: 'If that email is registered, an OTP has been sent' };

    if (staff.is_active !== 1) {
        throw ApiError.forbidden('Your account is inactive. Please contact your vendor.');
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await staff.update({ password_reset_token: otp, password_reset_expires: otpExpires });

    try {
        await emailSenderService.sendEmail('password_reset_otp', {
            to: staff.email,
            variables: {
                user_name: staff.name || 'Staff',
                otp_code: otp,
                expiry_time: '10 minutes',
            },
        });
    } catch (_) { /* email errors are non-fatal */ }

    return { success: true, message: 'If that email is registered, an OTP has been sent' };
};

/**
 * Verify OTP
 */
const verifyResetOTP = async (email, otp) => {
    const staff = await VendorStaff.findOne({
        where: { email },
        attributes: { include: ['password_reset_token', 'password_reset_expires'] },
    });

    if (!staff) throw ApiError.badRequest('Invalid email or OTP');
    if (staff.password_reset_token !== otp) throw ApiError.badRequest('Invalid OTP');
    if (!staff.password_reset_expires || staff.password_reset_expires < new Date()) {
        throw ApiError.badRequest('OTP has expired. Please request a new one.');
    }

    return { success: true, message: 'OTP verified successfully' };
};

/**
 * Reset password using OTP
 */
const resetPassword = async (email, otp, newPassword) => {
    const staff = await VendorStaff.findOne({
        where: { email },
        attributes: { include: ['password', 'password_reset_token', 'password_reset_expires'] },
    });

    if (!staff) throw ApiError.badRequest('Invalid email or OTP');
    if (staff.password_reset_token !== otp) throw ApiError.badRequest('Invalid OTP');
    if (!staff.password_reset_expires || staff.password_reset_expires < new Date()) {
        throw ApiError.badRequest('OTP has expired. Please request a new one.');
    }

    await staff.update({ password: newPassword, password_reset_token: null, password_reset_expires: null });

    return { success: true, message: 'Password reset successfully' };
};

/**
 * Change password (authenticated)
 */
const changePassword = async (staffId, currentPassword, newPassword) => {
    const staff = await VendorStaff.findByPk(staffId, {
        attributes: { include: ['password'] },
    });
    if (!staff) throw ApiError.notFound('Staff member not found');

    const isValid = await staff.validatePassword(currentPassword);
    if (!isValid) throw ApiError.badRequest('Current password is incorrect');

    await staff.update({ password: newPassword });
    return true;
};

module.exports = { login, getProfile, forgotPassword, verifyResetOTP, resetPassword, changePassword };
