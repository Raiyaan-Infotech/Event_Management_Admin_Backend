/**
 * Staff Portal Controllers
 * Same services as vendor, but scoped via req.staff.vendor_id (staff JWT)
 */
const vendorClientService     = require('../services/vendorClient.service');
const vendorStaffService      = require('../services/vendorStaff.service');
const vendorRoleService       = require('../services/vendorRole.service');
const vendorPermissionService = require('../services/vendorPermission.service');
const vendorService           = require('../services/vendor.service');
const vendorPageService       = require('../services/vendorPage.service');
const ApiResponse             = require('../utils/apiResponse');
const { asyncHandler }        = require('../utils/helpers');

// ─── Clients ──────────────────────────────────────────────────────────────────
const getClients = asyncHandler(async (req, res) => {
    const result = await vendorClientService.getAll(req.query, req.staff.vendor_id);
    ApiResponse.success(res, result, 'Clients retrieved successfully');
});

const getClientById = asyncHandler(async (req, res) => {
    const client = await vendorClientService.getById(req.params.id, req.staff.vendor_id);
    ApiResponse.success(res, { client }, 'Client retrieved successfully');
});

const createClient = asyncHandler(async (req, res) => {
    const client = await vendorClientService.create(req.body, req.staff.vendor_id, req.staff.company_id);
    ApiResponse.success(res, client, 'Client created successfully', 201);
});

const updateClient = asyncHandler(async (req, res) => {
    const client = await vendorClientService.update(req.params.id, req.body, req.staff.vendor_id);
    ApiResponse.success(res, client, 'Client updated successfully');
});

const updateClientStatus = asyncHandler(async (req, res) => {
    const client = await vendorClientService.updateStatus(req.params.id, req.body.is_active, req.staff.vendor_id);
    ApiResponse.success(res, client, 'Client status updated successfully');
});

const deleteClient = asyncHandler(async (req, res) => {
    await vendorClientService.remove(req.params.id, req.staff.vendor_id);
    ApiResponse.success(res, null, 'Client deleted successfully');
});

// ─── Staff ────────────────────────────────────────────────────────────────────
const getStaff = asyncHandler(async (req, res) => {
    const result = await vendorStaffService.getAll(req.query, req.staff.vendor_id);
    ApiResponse.success(res, result, 'Staff retrieved successfully');
});

const getStaffById = asyncHandler(async (req, res) => {
    const staff = await vendorStaffService.getById(req.params.id, req.staff.vendor_id);
    ApiResponse.success(res, { staff }, 'Staff retrieved successfully');
});

const createStaff = asyncHandler(async (req, res) => {
    if (req.body.role_id !== undefined) {
        return ApiResponse.error(res, 'Role assignment is not allowed from the staff portal. Only the vendor can assign roles.', 403);
    }
    const staff = await vendorStaffService.create(req.body, req.staff.vendor_id, req.staff.company_id);
    ApiResponse.success(res, staff, 'Staff created successfully', 201);
});

const VENDOR_ONLY_FIELDS = ['role_id', 'password', 'is_active', 'login_access', 'emp_id', 'vendor_id'];

const updateStaff = asyncHandler(async (req, res) => {
    const restricted = VENDOR_ONLY_FIELDS.filter(f => req.body[f] !== undefined);
    if (restricted.length > 0) {
        return ApiResponse.error(res, `Field(s) [${restricted.join(', ')}] can only be changed by the vendor`, 403);
    }
    const staff = await vendorStaffService.update(req.params.id, req.body, req.staff.vendor_id);
    ApiResponse.success(res, staff, 'Staff updated successfully');
});

const updateStaffStatus = asyncHandler(async (req, res) => {
    if (parseInt(req.params.id) === req.staff.id) {
        return ApiResponse.error(res, 'You cannot change your own account status', 403);
    }
    const staff = await vendorStaffService.updateStatus(req.params.id, req.body.is_active, req.staff.vendor_id);
    ApiResponse.success(res, staff, 'Staff status updated successfully');
});

const deleteStaff = asyncHandler(async (req, res) => {
    if (parseInt(req.params.id) === req.staff.id) {
        return ApiResponse.error(res, 'You cannot delete your own account', 403);
    }
    await vendorStaffService.remove(req.params.id, req.staff.vendor_id);
    ApiResponse.success(res, null, 'Staff deleted successfully');
});

// ─── Roles ────────────────────────────────────────────────────────────────────
const getRoles = asyncHandler(async (req, res) => {
    const result = await vendorRoleService.getAll(req.query, req.staff.vendor_id);
    ApiResponse.success(res, result, 'Roles retrieved successfully');
});

const getRoleById = asyncHandler(async (req, res) => {
    const role = await vendorRoleService.getById(req.params.id, req.staff.vendor_id);
    ApiResponse.success(res, { role }, 'Role retrieved successfully');
});

const createRole = asyncHandler(async (req, res) => {
    const role = await vendorRoleService.create(req.body, req.staff.vendor_id);
    ApiResponse.success(res, { role }, 'Role created successfully', 201);
});

const updateRole = asyncHandler(async (req, res) => {
    if (req.staff.role_id && parseInt(req.params.id) === req.staff.role_id) {
        return ApiResponse.error(res, 'You cannot edit your own role', 403);
    }
    const role = await vendorRoleService.update(req.params.id, req.body, req.staff.vendor_id);
    ApiResponse.success(res, { role }, 'Role updated successfully');
});

const deleteRole = asyncHandler(async (req, res) => {
    if (req.staff.role_id && parseInt(req.params.id) === req.staff.role_id) {
        return ApiResponse.error(res, 'You cannot delete your own role', 403);
    }
    await vendorRoleService.remove(req.params.id, req.staff.vendor_id);
    ApiResponse.success(res, null, 'Role deleted successfully');
});

const assignRolePermissions = asyncHandler(async (req, res) => {
    if (req.staff.role_id && parseInt(req.params.id) === req.staff.role_id) {
        return ApiResponse.error(res, 'You cannot modify permissions of your own role', 403);
    }

    // Staff can only assign permissions they themselves have — prevents escalation
    const ownPermissionIds = (req.staff.role?.permissions || []).map(p => p.id);
    const requestedIds = (req.body.permissions || []).map(p =>
        typeof p === 'object' ? (p.permission_id || p.id) : p
    );
    const forbidden = requestedIds.filter(id => !ownPermissionIds.includes(id));
    if (forbidden.length > 0) {
        return ApiResponse.error(res, 'You cannot assign permissions that you do not have yourself', 403);
    }

    const role = await vendorRoleService.assignPermissions(req.params.id, req.body.permissions, req.staff.vendor_id);
    ApiResponse.success(res, { role }, 'Permissions assigned successfully');
});

// ─── Website About ────────────────────────────────────────────────────────────
const getWebsiteAbout = asyncHandler(async (req, res) => {
    const vendor = await vendorService.getProfile(req.staff.vendor_id);
    ApiResponse.success(res, vendor, 'Vendor profile retrieved successfully');
});

const updateWebsiteAbout = asyncHandler(async (req, res) => {
    const vendor = await vendorService.updateProfile(req.staff.vendor_id, req.body);
    ApiResponse.success(res, vendor, 'Vendor profile updated successfully');
});

// ─── Website Pages ────────────────────────────────────────────────────────────
const getPages = asyncHandler(async (req, res) => {
    const result = await vendorPageService.getAll(req.query, req.staff.vendor_id, req.staff.company_id);
    ApiResponse.success(res, result, 'Pages retrieved successfully');
});

const getPageById = asyncHandler(async (req, res) => {
    const page = await vendorPageService.getById(req.params.id, req.staff.vendor_id);
    ApiResponse.success(res, page, 'Page retrieved successfully');
});

const createPage = asyncHandler(async (req, res) => {
    const page = await vendorPageService.create(req.body, req.staff.vendor_id, req.staff.company_id);
    ApiResponse.success(res, page, 'Page created successfully', 201);
});

const updatePage = asyncHandler(async (req, res) => {
    const page = await vendorPageService.update(req.params.id, req.body, req.staff.vendor_id);
    ApiResponse.success(res, page, 'Page updated successfully');
});

const deletePage = asyncHandler(async (req, res) => {
    await vendorPageService.remove(req.params.id, req.staff.vendor_id);
    ApiResponse.success(res, null, 'Page deleted successfully');
});

// ─── Modules & Permissions (view only) ───────────────────────────────────────
const getModules = asyncHandler(async (req, res) => {
    const modules = await vendorPermissionService.getModules();
    ApiResponse.success(res, { modules });
});

const getPermissions = asyncHandler(async (req, res) => {
    const permissions = await vendorPermissionService.getPermissions();
    ApiResponse.success(res, { permissions });
});

module.exports = {
    // clients
    getClients, getClientById, createClient, updateClient, updateClientStatus, deleteClient,
    // staff
    getStaff, getStaffById, createStaff, updateStaff, updateStaffStatus, deleteStaff,
    // roles
    getRoles, getRoleById, createRole, updateRole, deleteRole, assignRolePermissions,
    // modules & permissions
    getModules, getPermissions,
    // website about
    getWebsiteAbout, updateWebsiteAbout,
    // website pages
    getPages, getPageById, createPage, updatePage, deletePage,
};
