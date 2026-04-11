const { VendorStaff, Role } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'VendorStaff';

// Sanitize date fields: convert "Invalid date" or invalid date strings to null
const sanitizeDateFields = (data) => {
    const dateFields = ['doj', 'dob', 'dor'];
    const sanitized = { ...data };
    
    for (const field of dateFields) {
        if (sanitized[field] !== undefined && sanitized[field] !== null) {
            const dateStr = String(sanitized[field]).trim();
            // Convert "Invalid date" string to null
            if (dateStr === 'Invalid date' || dateStr === '') {
                sanitized[field] = null;
            } else {
                // Validate the date string
                const parsedDate = new Date(dateStr);
                if (isNaN(parsedDate.getTime())) {
                    sanitized[field] = null;
                }
            }
        }
    }
    
    return sanitized;
};

// Fields staff portal is allowed to edit on a staff record
const STAFF_EDITABLE_FIELDS = ['name', 'mobile', 'designation', 'doj', 'address', 'work_status'];

// Fields allowed when creating a new staff member
// role_id is included so vendor portal can assign a role at creation — staff portal blocks it at controller level
const STAFF_CREATABLE_FIELDS = ['name', 'email', 'mobile', 'password', 'designation', 'doj', 'dob', 'dor', 'address', 'country', 'state', 'district', 'city', 'locality', 'pincode', 'work_status', 'profile_pic', 'role_id', 'login_access'];

const EXCLUDE_SENSITIVE = ['password', 'password_reset_token', 'password_reset_expires'];

const getAll = async (query = {}, vendorId) => {
    const customWhere = { vendor_id: vendorId };
    if (query.designation) customWhere.designation = query.designation;
    if (query.work_status) customWhere.work_status = query.work_status;

    return baseService.getAll(VendorStaff, MODEL_NAME, query, {
        searchFields: ['name', 'email', 'mobile', 'emp_id', 'designation'],
        sortableFields: ['created_at', 'name', 'is_active', 'designation', 'doj'],
        where: customWhere,
        attributes: { exclude: EXCLUDE_SENSITIVE },
    });
};

const getById = async (id, vendorId) => {
    const record = await VendorStaff.findOne({
        where: { id, vendor_id: vendorId },
        attributes: { exclude: EXCLUDE_SENSITIVE },
    });
    if (!record) throw ApiError.notFound('Staff member not found');
    return record;
};

const create = async (data, vendorId, companyId) => {
    // Validate role belongs to this vendor (if provided — vendor portal may pass role_id, staff portal must not)
    if (data.role_id) {
        const role = await Role.findOne({ where: { id: data.role_id, vendor_id: vendorId } });
        if (!role) throw ApiError.badRequest('Invalid role: role does not belong to this vendor');
    }

    // Whitelist allowed fields — prevents setting is_active, password_reset_token, etc.
    const safeData = {};
    for (const field of STAFF_CREATABLE_FIELDS) {
        if (data[field] !== undefined) safeData[field] = data[field];
    }

    // Sanitize date fields
    const sanitized = sanitizeDateFields(safeData);

    const count = await VendorStaff.count({ where: { vendor_id: vendorId } });
    const empId = `EMP-${String(count + 1).padStart(4, '0')}`;

    return baseService.create(VendorStaff, MODEL_NAME, {
        ...sanitized,
        vendor_id: vendorId,
        emp_id: empId,
        is_active: 1,
    }, null, companyId);
};

// Fields vendor portal can edit on a staff record (broader than staff portal)
// role_id is intentionally excluded — use PUT /vendors/staff/:id/role (reassignRole) which validates vendor ownership
const VENDOR_EDITABLE_FIELDS = ['name', 'mobile', 'designation', 'doj', 'dob', 'dor', 'address', 'country', 'state', 'district', 'city', 'locality', 'pincode', 'work_status', 'profile_pic', 'login_access', 'password'];


const update = async (id, data, vendorId, byVendor = false) => {
    const record = await VendorStaff.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Staff member not found');

    const allowedFields = byVendor ? VENDOR_EDITABLE_FIELDS : STAFF_EDITABLE_FIELDS;
    const safeData = {};
    for (const field of allowedFields) {
        if (data[field] !== undefined) safeData[field] = data[field];
    }

    // Sanitize date fields
    const sanitized = sanitizeDateFields(safeData);

    await record.update(sanitized);
    return record;
};

const updateStatus = async (id, isActive, vendorId) => {
    const record = await VendorStaff.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Staff member not found');
    await record.update({ is_active: isActive });
    return record;
};

const remove = async (id, vendorId) => {
    const record = await VendorStaff.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Staff member not found');
    await record.destroy();
    return true;
};

// Vendor-only: reassign a staff member to a different role
const reassignRole = async (staffId, roleId, vendorId) => {
    const staff = await VendorStaff.findOne({ where: { id: staffId, vendor_id: vendorId } });
    if (!staff) throw ApiError.notFound('Staff member not found');

    const role = await Role.findOne({ where: { id: roleId, vendor_id: vendorId } });
    if (!role) throw ApiError.notFound('Role not found or does not belong to this vendor');

    await staff.update({ role_id: roleId });
    return staff;
};

module.exports = { getAll, getById, create, update, updateStatus, remove, reassignRole };
