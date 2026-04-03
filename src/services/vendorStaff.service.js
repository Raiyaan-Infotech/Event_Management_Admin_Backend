const { VendorStaff } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'VendorStaff';

const getAll = async (query = {}, vendorId) => {
    const customWhere = { vendor_id: vendorId };
    // Extra filter: designation, work_status
    if (query.designation) customWhere.designation = query.designation;
    if (query.work_status) customWhere.work_status = query.work_status;

    return baseService.getAll(VendorStaff, MODEL_NAME, query, {
        searchFields: ['name', 'email', 'mobile', 'emp_id', 'designation'],
        sortableFields: ['created_at', 'name', 'is_active', 'designation', 'doj'],
        where: customWhere,
    });
};

const getById = async (id, vendorId) => {
    const record = await VendorStaff.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Staff member not found');
    return record;
};

const create = async (data, vendorId, companyId) => {
    const count = await VendorStaff.count({ where: { vendor_id: vendorId } });
    const empId = `EMP-${String(count + 1).padStart(4, '0')}`;

    return baseService.create(VendorStaff, MODEL_NAME, {
        ...data,
        vendor_id: vendorId,
        emp_id: empId,
        is_active: 1,
    }, null, companyId);
};

const update = async (id, data, vendorId) => {
    const record = await VendorStaff.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Staff member not found');
    delete data.vendor_id;
    delete data.emp_id;
    await record.update(data);
    return record;
};

const updateStatus = async (id, isActive, vendorId) => {
    return update(id, { is_active: isActive }, vendorId);
};

const remove = async (id, vendorId) => {
    const record = await VendorStaff.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Staff member not found');
    await record.destroy();
    return true;
};

module.exports = { getAll, getById, create, update, updateStatus, remove };
