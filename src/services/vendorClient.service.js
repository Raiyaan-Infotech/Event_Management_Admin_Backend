const { VendorClient } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'VendorClient';

// Fields allowed when creating a client — prevents setting vendor_id, company_id, client_id internally
const CLIENT_CREATABLE_FIELDS = [
    'name', 'email', 'mobile', 'profile_pic',
    'address', 'country', 'state', 'district', 'city', 'locality', 'pincode',
    'plan', 'registration_type', 'login_access', 'send_credentials_to_email',
    'password',
];

// Fields allowed when updating a client — company_id, vendor_id, client_id, is_active excluded
const CLIENT_EDITABLE_FIELDS = [
    'name', 'email', 'mobile', 'profile_pic',
    'address', 'country', 'state', 'district', 'city', 'locality', 'pincode',
    'plan', 'registration_type', 'login_access', 'send_credentials_to_email',
];

const getAll = async (query = {}, vendorId) => {
    const customWhere = { vendor_id: vendorId };
    // Extra filter: plan (base.service only handles status/is_active/type)
    if (query.plan) customWhere.plan = query.plan;

    return baseService.getAll(VendorClient, MODEL_NAME, query, {
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
    const count = await VendorClient.count({ where: { vendor_id: vendorId } });
    const clientId = `CLI-${String(count + 1).padStart(4, '0')}`;

    const safeData = {};
    for (const field of CLIENT_CREATABLE_FIELDS) {
        if (data[field] !== undefined) safeData[field] = data[field];
    }

    return baseService.create(VendorClient, MODEL_NAME, {
        ...safeData,
        vendor_id: vendorId,
        client_id: clientId,
        is_active: 1,
    }, null, companyId);
};

const update = async (id, data, vendorId) => {
    const record = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Client not found');

    const safeData = {};
    for (const field of CLIENT_EDITABLE_FIELDS) {
        if (data[field] !== undefined) safeData[field] = data[field];
    }

    await record.update(safeData);
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
