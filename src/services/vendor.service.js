const { Vendor, District, City, Subscription, Theme } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');
const emailSenderService = require('./emailSender.service');
const mediaService = require('./media.service');
const { validateVendorContactFields, validateVendorPasswordChange } = require('../utils/vendorValidation');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const MODEL_NAME = 'Vendor';

const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : value;
const normalizePlanName = (value) => String(value || '').trim().toLowerCase();
const normalizeEmailFields = (data) => {
    for (const field of ['email', 'company_email', 'alt_email']) {
        if (data[field] !== undefined && data[field] !== null) {
            data[field] = normalizeEmail(data[field]);
        }
    }
};

const findPlanByMembership = async (membership) => {
    const planName = normalizePlanName(membership);
    if (!planName) return null;
    const plans = await Subscription.findAll({
        where: { is_active: 1, is_custom: 0 },
        attributes: ['id', 'name'],
    });
    return plans.find((plan) => normalizePlanName(plan.name) === planName) || null;
};

const themeAllowedForPlan = (theme, planId) => {
    const { safeParseArray } = require('../utils/json');
    return safeParseArray(theme?.plans).map(Number).includes(Number(planId));
};

const validateThemeForMembership = async (membership, themeId) => {
    if (!membership || !themeId) return;
    const [plan, theme] = await Promise.all([
        findPlanByMembership(membership),
        Theme.findByPk(themeId, { attributes: ['id', 'plans', 'is_active'] }),
    ]);

    if (!plan || !theme || Number(theme.is_active) !== 1 || !themeAllowedForPlan(theme, plan.id)) {
        throw ApiError.badRequest('Selected theme is not available for the selected subscription plan');
    }
};

const getAll = async (query = {}, companyId = undefined) => {
    return baseService.getAll(Vendor, MODEL_NAME, query, {
        searchFields: ['name', 'email', 'company_name', 'contact'],
        sortableFields: ['created_at', 'name', 'company_name', 'status', 'membership'],
        companyId,
        moduleSlug: 'vendors',
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(Vendor, MODEL_NAME, id, {
        companyId,
    });
};

// For vendor portal /auth/about — includes city join for city name display
const getProfile = async (vendorId) => {
    const vendor = await Vendor.findByPk(vendorId, {
        include: [
            { model: District, as: 'district', attributes: ['id', 'name'] },
            { model: City, as: 'locality', attributes: ['id', 'name', 'pincode'] },
        ],
    });
    if (!vendor) throw ApiError.notFound('Vendor not found');
    const json = vendor.toJSON();
    json.city = json.locality?.name || json.district?.name || null;
    return json;
};

// For auth — needs password field included
const getByEmailWithPassword = async (email) => {
    return Vendor.findOne({ where: { email }, attributes: { include: ['password'] } });
};

const normalizeMedia = (data, companyId) => {
    return mediaService.uploadDataUriFields(data, ['company_logo'], { folder: 'vendors' }, companyId);
};

const create = async (data, companyId = undefined) => {
    normalizeEmailFields(data);
    await validateThemeForMembership(data.membership, data.theme_id);
    const existing = await Vendor.findOne({ where: { email: data.email } });
    if (existing) throw ApiError.conflict('A vendor with this email already exists');
    const normalized = await normalizeMedia(data, companyId);
    return baseService.create(Vendor, MODEL_NAME, normalized, null, companyId);
};

const update = async (id, data, companyId = undefined) => {
    normalizeEmailFields(data);
    // Don't allow empty password on update — remove it so hash hook doesn't run
    if (data.password === '' || data.password === null || data.password === undefined) {
        delete data.password;
    }
    if (data.membership && data.theme_id) {
        await validateThemeForMembership(data.membership, data.theme_id);
    }
    if (data.theme_id !== undefined) {
        data.home_blocks = null;
    }
    if (data.email) {
        const { Op } = require('sequelize');
        const existing = await Vendor.findOne({ where: { email: data.email, id: { [Op.ne]: id } } });
        if (existing) throw ApiError.conflict('A vendor with this email already exists');
    }
    const normalized = await normalizeMedia(data, companyId);
    return baseService.update(Vendor, MODEL_NAME, id, normalized, null, companyId);
};

const updateStatus = async (id, status, companyId = undefined) => {
    return baseService.update(Vendor, MODEL_NAME, id, { status }, null, companyId);
};

const remove = async (id, companyId = undefined) => {
    return baseService.remove(Vendor, MODEL_NAME, id, null, companyId, { uniqueFields: ['email'] });
};

// Vendor updates their own profile (no password change here)
const updateProfile = async (vendorId, data) => {
    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    // Exclude sensitive/protected fields from self-update
    const allowed = [
        'name', 'contact', 'alt_contact', 'address', 'alt_address', 'alt_email', 'profile',
        'company_name', 'company_logo', 'company_contact', 'company_address', 'about_us', 'short_description',
        'company_email', 'website',
        'bank_name', 'acc_no', 'ifsc_code', 'acc_type', 'branch',
        'copywrite', 'poweredby', 'newsletter_status', 'footer_links', 'nav_menu', 'contact_mode',
    ];
    const filtered = {};
    for (const key of allowed) {
        if (data[key] !== undefined) filtered[key] = data[key];
    }

    if (filtered.acc_type === '') delete filtered.acc_type;
    if (filtered.contact_mode === '') delete filtered.contact_mode;
    validateVendorContactFields(filtered);

    const normalized = await normalizeMedia(filtered, vendor.company_id);
    await vendor.update(normalized);
    return vendor.toJSON();
};

// Vendor changes their own password
const changePassword = async (vendorId, currentPassword, newPassword) => {
    validateVendorPasswordChange({ currentPassword, newPassword });

    const vendor = await Vendor.findByPk(vendorId, {
        attributes: { include: ['password'] },
    });
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const isValid = await vendor.validatePassword(currentPassword);
    if (!isValid) throw ApiError.badRequest('Current password is incorrect');

    await vendor.update({ password: newPassword });
    return true;
};

// Send OTP email for password reset
const forgotPassword = async (email) => {
    const vendor = await Vendor.findOne({
        where: { email },
        attributes: { include: ['password_reset_token', 'password_reset_expires'] },
    });

    // Don't reveal if email exists
    if (!vendor) return { success: true, message: 'If that email is registered, an OTP has been sent' };

    if (vendor.status !== 'active') {
        throw ApiError.forbidden('Your account is inactive. Please contact the administrator.');
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await vendor.update({ password_reset_token: otp, password_reset_expires: otpExpires });

    try {
        await emailSenderService.sendEmail('password_reset_otp', {
            to: vendor.email,
            variables: {
                user_name: vendor.name || 'Vendor',
                otp_code: otp,
                expiry_time: '10 minutes',
            },
            companyId: vendor.company_id || null,
        });
    } catch (_) { /* email errors are non-fatal */ }

    return { success: true, message: 'If that email is registered, an OTP has been sent' };
};

// Reset password using OTP
const resetPassword = async (email, otp, newPassword) => {
    const vendor = await Vendor.findOne({
        where: { email },
        attributes: { include: ['password', 'password_reset_token', 'password_reset_expires'] },
    });

    if (!vendor) throw ApiError.badRequest('Invalid email or OTP');
    if (vendor.password_reset_token !== otp) throw ApiError.badRequest('Invalid OTP');
    if (!vendor.password_reset_expires || vendor.password_reset_expires < new Date()) {
        throw ApiError.badRequest('OTP has expired. Please request a new one.');
    }

    await vendor.update({ password: newPassword, password_reset_token: null, password_reset_expires: null });

    try {
        await emailSenderService.sendEmail('password_changed', {
            to: vendor.email,
            variables: { user_name: vendor.name || 'Vendor' },
            companyId: vendor.company_id || null,
        });
    } catch (_) { /* email errors are non-fatal */ }

    return true;
};

module.exports = { getAll, getById, getProfile, getByEmailWithPassword, create, update, updateStatus, remove, updateProfile, changePassword, forgotPassword, resetPassword };
