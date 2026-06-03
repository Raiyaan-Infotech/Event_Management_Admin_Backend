const { VendorClient } = require('../models');
const { Op } = require('sequelize');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');
const { v4: uuidv4 } = require('uuid');
const mediaService = require('./media.service');
const { validateClientPassword } = require('../utils/clientPasswordPolicy');

const MODEL_NAME = 'VendorClient';
const generateClientId = () => `CLI-${uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

const normalizeClientInput = (data) => {
    for (const field of ['name', 'mobile', 'email', 'address', 'country', 'state', 'district', 'city', 'locality', 'pincode', 'plan', 'registration_type']) {
        if (typeof data[field] === 'string') data[field] = data[field].trim();
    }
    if (data.email) data.email = data.email.toLowerCase();
    if (data.registration_type) data.registration_type = data.registration_type.toLowerCase();
};

const rejectOnlySymbols = (value, label) => {
    const trimmed = String(value || '').trim();
    if (trimmed && !/[A-Za-z0-9]/.test(trimmed) && /^[\W_]+$/.test(trimmed)) {
        throw ApiError.badRequest(`${label} cannot contain only special characters or underscores`);
    }
};

const validateClientInput = (data, { isUpdate = false } = {}) => {
    const requiredFields = [
        ['name', 'Full Name'],
        ['mobile', 'Mobile Number'],
        ['email', 'Email Address'],
        ['address', 'Street Address'],
        ['country', 'Country'],
        ['state', 'State'],
        ['district', 'District'],
        ['city', 'City'],
        ['locality', 'Locality'],
        ['pincode', 'Pincode'],
    ];

    for (const [field, label] of requiredFields) {
        if (!isUpdate || data[field] !== undefined) {
            if (!String(data[field] || '').trim()) throw ApiError.badRequest(`${label} is required`);
        }
    }

    for (const [field, label] of [['name', 'Full Name'], ['address', 'Street Address'], ['locality', 'Locality'], ['pincode', 'Pincode']]) {
        if (data[field] !== undefined) rejectOnlySymbols(data[field], label);
    }

    if (data.mobile !== undefined) {
        const mobile = String(data.mobile || '').trim();
        const digits = mobile.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15 || !/^\+?[0-9 ]{7,20}$/.test(mobile)) {
            throw ApiError.badRequest('Enter a valid mobile number');
        }
    }
};

// Fields allowed when creating a client — prevents setting vendor_id, company_id, client_id internally
const CLIENT_CREATABLE_FIELDS = [
    'name', 'email', 'mobile', 'profile_pic',
    'address', 'country', 'state', 'district', 'city', 'locality', 'pincode',
    'subscription_id', 'plan', 'registration_type', 'client_type', 'login_access', 'send_credentials_to_email',
    'password',
];

// Fields allowed when updating a client — company_id, vendor_id, client_id, is_active excluded
const CLIENT_EDITABLE_FIELDS = [
    'name', 'email', 'mobile', 'profile_pic',
    'address', 'country', 'state', 'district', 'city', 'locality', 'pincode',
    'subscription_id', 'plan', 'registration_type', 'client_type', 'login_access', 'send_credentials_to_email',
    'password',
];

const getAll = async (query = {}, vendorId) => {
    const customWhere = { vendor_id: vendorId };
    const queryForBase = { ...query };
    if (queryForBase.status !== undefined && queryForBase.is_active === undefined) {
        queryForBase.is_active = queryForBase.status;
    }
    delete queryForBase.status;

    if (queryForBase.is_active !== undefined && queryForBase.is_active !== '') {
        customWhere.is_active = Number(queryForBase.is_active);
        delete queryForBase.is_active;
    }

    if (query.plan) {
        if (String(query.plan).toLowerCase() === 'guest') {
            customWhere.registration_type = 'guest';
        } else {
            customWhere.plan = query.plan;
        }
    }

    if (query.search && /^\d+$/.test(String(query.search).trim())) {
        const search = String(query.search).trim();
        customWhere[Op.or] = [
            { id: Number(search) },
            { client_id: { [Op.like]: `%${search}%` } },
            { name: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { mobile: { [Op.like]: `%${search}%` } },
            { city: { [Op.like]: `%${search}%` } },
        ];
        delete queryForBase.search;
    }

    return baseService.getAll(VendorClient, MODEL_NAME, queryForBase, {
        searchFields: ['name', 'email', 'mobile', 'client_id', 'city'],
        sortableFields: ['created_at', 'name', 'is_active', 'plan'],
        where: customWhere,
    });
};

const getById = async (id, vendorId) => {
    const record = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Client not found');
    return record;
};

const create = async (data, vendorId, companyId) => {
    normalizeClientInput(data);
    validateClientInput(data);
    if (data.password) validateClientPassword(data.password);
    // Normalize email — lowercase + trim before any check or save

    if (data.email) {
        // paranoid: false so soft-deleted clients are also checked — prevents email reuse
        const existing = await VendorClient.findOne({
            where: { email: data.email },
            paranoid: false,
        });
        if (existing) throw ApiError.conflict('A client with this email is already registered.');
    }

    const safeData = {};
    for (const field of CLIENT_CREATABLE_FIELDS) {
        if (data[field] !== undefined) safeData[field] = data[field];
    }

    const normalized = await mediaService.uploadDataUriFields(safeData, ['profile_pic'], { folder: 'clients' }, companyId);

    return baseService.create(VendorClient, MODEL_NAME, {
        ...normalized,
        vendor_id: vendorId,
        client_id: generateClientId(),
        is_active: 1,
    }, null, companyId);
};

const update = async (id, data, vendorId) => {
    const record = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Client not found');
    normalizeClientInput(data);
    validateClientInput(data, { isUpdate: true });
    if (data.password) validateClientPassword(data.password);

    if (data.email) {
        const existing = await VendorClient.findOne({
            where: {
                email: data.email,
                id: { [Op.ne]: id },
            },
            paranoid: false,
        });
        if (existing) throw ApiError.conflict('A client with this email is already registered.');
    }

    const safeData = {};
    for (const field of CLIENT_EDITABLE_FIELDS) {
        if (data[field] !== undefined) safeData[field] = data[field];
    }

    const normalized = await mediaService.uploadDataUriFields(safeData, ['profile_pic'], { folder: 'clients' }, record.company_id);
    await record.update(normalized);
    return record;
};

const updateStatus = async (id, isActive, vendorId) => {
    const record = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Client not found');
    await record.update({ is_active: isActive });
    return record;
};

const remove = async (id, vendorId) => {
    const record = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Client not found');
    await record.destroy();
    return true;
};

module.exports = { getAll, getById, create, update, updateStatus, remove };
