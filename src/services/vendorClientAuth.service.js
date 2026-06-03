const { VendorClient, Vendor } = require('../models');
const ApiError = require('../utils/apiError');
const { validateClientPassword } = require('../utils/clientPasswordPolicy');
const { revokeAllClientRefreshTokens } = require('../utils/clientSession');
const mediaService = require('./media.service');

const getProfile = async (clientId) => {
    const client = await VendorClient.findByPk(clientId, {
        include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'company_name', 'company_logo', 'status'] }],
    });
    if (!client) throw ApiError.notFound('Client not found');
    return client;
};

const getHandoffClient = async (clientId, vendorId) => {
    const client = await VendorClient.findOne({
        where: { id: clientId, vendor_id: vendorId },
        include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'company_name', 'company_logo', 'status'] }],
    });
    if (!client) throw ApiError.unauthorized('Invalid or expired client login handoff.');
    if (client.is_active !== 1) throw ApiError.forbidden('Your account is inactive. Please contact the vendor.');
    if (client.login_access !== 1) throw ApiError.forbidden('Login access is not enabled. Please contact the vendor.');
    if (client.vendor && client.vendor.status !== 'active') {
        throw ApiError.forbidden('Vendor account is suspended. Please contact support.');
    }
    return client;
};

const updateProfile = async (clientId, data) => {
    const client = await VendorClient.findByPk(clientId);
    if (!client) throw ApiError.notFound('Client not found');

    const editableFields = ['name', 'mobile', 'profile_pic', 'address', 'country', 'state', 'district', 'city', 'locality', 'pincode'];
    const safeData = {};
    for (const field of editableFields) {
        if (data[field] !== undefined) safeData[field] = data[field];
    }

    const normalized = await mediaService.uploadDataUriFields(safeData, ['profile_pic'], { folder: 'clients' }, client.company_id);
    await client.update(normalized);
    return getProfile(clientId);
};

const changePassword = async (clientId, currentPassword, newPassword) => {
    validateClientPassword(newPassword);
    const client = await VendorClient.findByPk(clientId, {
        attributes: { include: ['password'] },
    });
    if (!client) throw ApiError.notFound('Client not found');

    const isValid = await client.validatePassword(currentPassword);
    if (!isValid) throw ApiError.badRequest('Current password is incorrect');

    await client.update({ password: newPassword });
    await revokeAllClientRefreshTokens(clientId);
    return true;
};

const forgotPassword = async (email) => {
    const client = await VendorClient.findOne({ where: { email } });
    if (!client) throw ApiError.notFound('No account found with this email address.');
    if (client.is_active !== 1) throw ApiError.forbidden('Your account is inactive. Please contact the vendor.');
    if (client.login_access !== 1) throw ApiError.forbidden('Login access is not enabled for this account.');

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    await client.update({ reset_token: otp, reset_token_expires_at: expiresAt });
    return { otp, clientName: client.name };
};

const resetPassword = async (email, otp, newPassword) => {
    validateClientPassword(newPassword);
    const client = await VendorClient.findOne({
        where: { email },
        attributes: { include: ['reset_token', 'reset_token_expires_at'] },
    });
    if (!client) throw ApiError.notFound('No account found with this email address.');
    if (!client.reset_token || client.reset_token !== otp) throw ApiError.badRequest('Invalid or expired reset code.');
    if (!client.reset_token_expires_at || new Date() > new Date(client.reset_token_expires_at)) {
        throw ApiError.badRequest('Reset code has expired. Please request a new one.');
    }
    await client.update({ password: newPassword, reset_token: null, reset_token_expires_at: null });
    await revokeAllClientRefreshTokens(client.id);
    return true;
};

module.exports = { getProfile, getHandoffClient, updateProfile, changePassword, forgotPassword, resetPassword };
