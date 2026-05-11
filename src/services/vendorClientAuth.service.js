const { VendorClient, Vendor } = require('../models');
const ApiError = require('../utils/apiError');

const login = async (email, password) => {
    const client = await VendorClient.findOne({
        where: { email },
        attributes: { include: ['password'] },
        include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'company_name', 'company_logo', 'status'] }],
    });

    if (!client) throw ApiError.unauthorized('Invalid email or password');

    const isValid = await client.validatePassword(password);
    if (!isValid) throw ApiError.unauthorized('Invalid email or password');

    if (client.is_active !== 1) {
        throw ApiError.forbidden('Your account is inactive. Please contact the vendor.');
    }

    if (client.login_access !== 1) {
        throw ApiError.forbidden('Login access is not enabled. Please contact the vendor.');
    }

    if (client.vendor && client.vendor.status !== 'active') {
        throw ApiError.forbidden('Vendor account is suspended. Please contact support.');
    }

    return client;
};

const getProfile = async (clientId) => {
    const client = await VendorClient.findByPk(clientId, {
        include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'company_name', 'company_logo', 'status'] }],
    });
    if (!client) throw ApiError.notFound('Client not found');
    return client;
};

const updateProfile = async (clientId, data) => {
    const client = await VendorClient.findByPk(clientId);
    if (!client) throw ApiError.notFound('Client not found');

    const editableFields = ['mobile', 'profile_pic', 'address', 'country', 'state', 'district', 'city', 'locality', 'pincode'];
    const safeData = {};
    for (const field of editableFields) {
        if (data[field] !== undefined) safeData[field] = data[field];
    }

    await client.update(safeData);
    return getProfile(clientId);
};

const changePassword = async (clientId, currentPassword, newPassword) => {
    const client = await VendorClient.findByPk(clientId, {
        attributes: { include: ['password'] },
    });
    if (!client) throw ApiError.notFound('Client not found');

    const isValid = await client.validatePassword(currentPassword);
    if (!isValid) throw ApiError.badRequest('Current password is incorrect');

    await client.update({ password: newPassword });
    return true;
};

module.exports = { login, getProfile, updateProfile, changePassword };
