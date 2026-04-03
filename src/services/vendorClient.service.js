const { VendorClient } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'VendorClient';

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

    return baseService.create(VendorClient, MODEL_NAME, {
        ...data,
        vendor_id: vendorId,
        client_id: clientId,
        is_active: 1,
    }, null, companyId);
};

const update = async (id, data, vendorId) => {
    const record = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Client not found');
    delete data.vendor_id;
    delete data.client_id;
    await record.update(data);
    return record;
};

const updateStatus = async (id, isActive, vendorId) => {
    return update(id, { is_active: isActive }, vendorId);
};

const remove = async (id, vendorId) => {
    const record = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Client not found');
    await record.destroy();
    return true;
};

module.exports = { getAll, getById, create, update, updateStatus, remove };
