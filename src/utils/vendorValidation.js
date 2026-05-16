const ApiError = require('./apiError');

const EMAIL_FIELDS = ['company_email', 'alt_email'];
const PHONE_FIELDS = ['company_contact', 'contact', 'alt_contact'];

const isValidEmail = (value) => /^[^\s@]+@[^\s@]{2,}\.[^\s@]{2,}$/.test(String(value).trim());

const isValidPhone = (value) => {
    const trimmed = String(value).trim();
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15 && /^\+?[\d\s\-(). ]{7,20}$/.test(trimmed);
};

const validateVendorContactFields = (data) => {
    for (const field of EMAIL_FIELDS) {
        if (data[field] !== undefined && data[field] !== null && String(data[field]).trim() !== '') {
            if (!isValidEmail(data[field])) throw ApiError.badRequest('Enter a valid email address');
            data[field] = String(data[field]).trim().toLowerCase();
        }
    }

    for (const field of PHONE_FIELDS) {
        if (data[field] !== undefined && data[field] !== null && String(data[field]).trim() !== '') {
            if (!isValidPhone(data[field])) throw ApiError.badRequest('Enter a valid mobile number');
            data[field] = String(data[field]).trim();
        }
    }
};

const validateVendorPasswordChange = ({ currentPassword, newPassword }) => {
    if (typeof currentPassword !== 'string' || currentPassword.trim().length === 0) {
        throw ApiError.badRequest('Current password is required');
    }

    if (typeof newPassword !== 'string' || newPassword.trim().length === 0) {
        throw ApiError.badRequest('Password is required');
    }

    if (/\s/.test(newPassword)) throw ApiError.badRequest('Password must not contain spaces');
    if (newPassword.length < 8) throw ApiError.badRequest('Password must be at least 8 characters');
    if (newPassword.length > 8) throw ApiError.badRequest('Password must not exceed 8 characters');
    if (!/[A-Z]/.test(newPassword)) throw ApiError.badRequest('Password must include at least 1 uppercase letter');
    if (!/[a-z]/.test(newPassword)) throw ApiError.badRequest('Password must include at least 1 lowercase letter');
    if (!/[0-9]/.test(newPassword)) throw ApiError.badRequest('Password must include at least 1 number');
    if (!/[^A-Za-z0-9\s]/.test(newPassword)) throw ApiError.badRequest('Password must include at least 1 special character');
};

module.exports = {
    validateVendorContactFields,
    validateVendorPasswordChange,
};
