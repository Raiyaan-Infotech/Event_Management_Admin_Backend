const express = require('express');
const router = express.Router();
const multer = require('multer');
const vendorController = require('../controllers/vendor.controller');
const vendorClientController = require('../controllers/vendorClient.controller');
const vendorSubscriberController = require('../controllers/vendorSubscriber.controller');
const vendorClientAuthController = require('../controllers/vendorClientAuth.controller');
const vendorStaffController = require('../controllers/vendorStaff.controller');
const vendorStaffAuthController = require('../controllers/vendorStaffAuth.controller');
const vendorRoleController       = require('../controllers/vendorRole.controller');
const vendorDepartmentController  = require('../controllers/vendorDepartment.controller');
const vendorPermissionController = require('../controllers/vendorPermission.controller');
const staffPortalController = require('../controllers/staffPortal.controller');
const vendorNewsletterController = require('../controllers/vendorNewsletter.controller');
const vendorSubscriptionController = require('../controllers/vendorSubscription.controller');
const vendorWebsiteBuilderRoutes = require('./vendorWebsiteBuilder.routes');
const mediaService = require('../services/media.service');
const ApiResponse = require('../utils/apiResponse');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { isVendorAuthenticated } = require('../middleware/vendorAuth');
const { isStaffAuthenticated, hasStaffPermission } = require('../middleware/staffAuth');
const { isClientAuthenticated } = require('../middleware/clientAuth');
const { checkApprovalRequired } = require('../middleware/approval');
const { asyncHandler } = require('../utils/helpers');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed'), false);
    },
});

const websiteManagementRemoved = (req, res) => {
    return res.status(410).json({
        success: false,
        message: 'Website Management has been removed from this project build.',
    });
};

router.use([
    '/ui-blocks',
    '/social-links',
    '/staff/portal/website',
    '/staff/portal/pages',
    '/pages',
    '/sliders',
    '/hero-section',
    '/portfolio',
    '/gallery',
    '/testimonials',
    '/subscription/themes',
    '/subscription/theme',
    '/subscription/colors',
    '/subscription/palette',
    '/color-palettes',
    '/home-blocks',
    '/auth/preview-data',
    '/:id/preview-data',
    // '/:vendorId/social-links',
], websiteManagementRemoved);

// ─── Staff Auth (public) ──────────────────────────────────────────────────────
router.post('/staff/auth/login',             vendorStaffAuthController.staffLogin);
router.post('/staff/auth/forgot-password',   vendorStaffAuthController.staffForgotPassword);
router.post('/staff/auth/verify-reset-otp',  vendorStaffAuthController.staffVerifyResetOTP);
router.post('/staff/auth/reset-password',    vendorStaffAuthController.staffResetPassword);

// ─── Client Portal Auth (public) ──────────────────────────────────────────────
router.post('/client/auth/handoff',         vendorClientAuthController.clientHandoff);
router.post('/client/auth/forgot-password', vendorClientAuthController.clientForgotPassword);
router.post('/client/auth/reset-password',  vendorClientAuthController.clientResetPassword);

// ─── Staff Auth (protected — staff JWT) ───────────────────────────────────────
router.post('/staff/auth/logout',           isStaffAuthenticated, vendorStaffAuthController.staffLogout);
router.get('/staff/auth/me',               isStaffAuthenticated, vendorStaffAuthController.staffMe);
router.put('/staff/auth/change-password',  isStaffAuthenticated, vendorStaffAuthController.staffChangePassword);

// ─── Client Portal Auth (protected — client JWT) ──────────────────────────────
router.post('/client/auth/logout',          isClientAuthenticated, vendorClientAuthController.clientLogout);
router.get('/client/auth/me',               isClientAuthenticated, vendorClientAuthController.clientMe);
router.put('/client/auth/profile',          isClientAuthenticated, vendorClientAuthController.updateClientProfile);
router.put('/client/auth/change-password',  isClientAuthenticated, vendorClientAuthController.changeClientPassword);
router.get('/client/subscription/plans',    isClientAuthenticated, vendorSubscriptionController.getClientPlans);
// ─── Vendor Portal Auth (public) ─────────────────────────────────────────────
router.post('/auth/login',           vendorController.login);
router.post('/auth/logout',          vendorController.logout);
router.post('/auth/forgot-password', vendorController.forgotPassword);
router.post('/auth/reset-password',  vendorController.resetPassword);

// ─── Vendor Portal — protected (vendor JWT) ───────────────────────────────────
router.get('/auth/me',               isVendorAuthenticated, vendorController.me);
router.put('/auth/profile',          isVendorAuthenticated, vendorController.updateProfile);
router.post('/auth/change-password', isVendorAuthenticated, vendorController.changePassword);
router.get('/auth/activity',         isVendorAuthenticated, vendorController.getMyActivity);
router.get('/auth/about',            isVendorAuthenticated, vendorController.getAbout);
router.put('/auth/about',            isVendorAuthenticated, vendorController.updateAbout);

// Website Builder rebuild APIs. The old removed website-management paths stay
// blocked above; new frontend work should call /api/v1/vendors/website/*.
router.use('/website', isVendorAuthenticated, vendorWebsiteBuilderRoutes);

// ─── Vendor Media Upload (vendor JWT) ────────────────────────────────────────
router.post('/auth/upload', isVendorAuthenticated, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
        next();
    });
}, asyncHandler(async (req, res) => {
    if (!req.file) return ApiResponse.error(res, 'No file provided', 400);
    const result = await mediaService.upload(req.file, { folder: req.body.folder || 'vendors' }, req.vendor.company_id);
    return ApiResponse.success(res, { file: result }, 'File uploaded successfully');
}));

// ─── Vendor RBAC — Roles (vendor JWT) ────────────────────────────────────────
router.get('/roles',                  isVendorAuthenticated, vendorRoleController.getAll);
router.get('/roles/:id',              isVendorAuthenticated, vendorRoleController.getById);
router.post('/roles',                 isVendorAuthenticated, vendorRoleController.create);
router.put('/roles/:id',              isVendorAuthenticated, vendorRoleController.update);
router.delete('/roles/:id',           isVendorAuthenticated, vendorRoleController.delete);
router.put('/roles/:id/permissions',  isVendorAuthenticated, vendorRoleController.assignPermissions);

// ─── Departments ──────────────────────────────────────────────────────────────
router.get('/departments',     isVendorAuthenticated, vendorDepartmentController.getAll);
router.get('/departments/:id', isVendorAuthenticated, vendorDepartmentController.getById);
router.post('/departments',    isVendorAuthenticated, vendorDepartmentController.create);
router.put('/departments/:id', isVendorAuthenticated, vendorDepartmentController.update);
router.delete('/departments/:id', isVendorAuthenticated, vendorDepartmentController.delete);

// ─── Vendor RBAC — Modules & Permissions (vendor JWT, view only) ─────────────
router.get('/modules',                isVendorAuthenticated, vendorPermissionController.getModules);
router.get('/permissions',            isVendorAuthenticated, vendorPermissionController.getPermissions);

// ─── Staff Portal — Clients (staff JWT, permission-gated) ────────────────────
router.get('/staff/portal/clients',        isStaffAuthenticated, hasStaffPermission('client.view'),   staffPortalController.getClients);
router.get('/staff/portal/clients/:id',    isStaffAuthenticated, hasStaffPermission('client.view'),   staffPortalController.getClientById);
router.post('/staff/portal/clients',       isStaffAuthenticated, hasStaffPermission('client.create'), staffPortalController.createClient);
router.put('/staff/portal/clients/:id',    isStaffAuthenticated, hasStaffPermission('client.edit'),   staffPortalController.updateClient);
router.patch('/staff/portal/clients/:id',  isStaffAuthenticated, hasStaffPermission('client.edit'),   staffPortalController.updateClientStatus);
router.delete('/staff/portal/clients/:id', isStaffAuthenticated, hasStaffPermission('client.delete'), staffPortalController.deleteClient);

// ─── Staff Portal — Staff (staff JWT, permission-gated) ──────────────────────
router.get('/staff/portal/staff',          isStaffAuthenticated, hasStaffPermission('staff.view'),   staffPortalController.getStaff);
router.get('/staff/portal/staff/:id',      isStaffAuthenticated, hasStaffPermission('staff.view'),   staffPortalController.getStaffById);
router.post('/staff/portal/staff',         isStaffAuthenticated, hasStaffPermission('staff.create'), staffPortalController.createStaff);
router.put('/staff/portal/staff/:id',      isStaffAuthenticated, hasStaffPermission('staff.edit'),   staffPortalController.updateStaff);
// NOTE: is_active and login_access changes are vendor-only — no PATCH in staff portal
router.delete('/staff/portal/staff/:id',   isStaffAuthenticated, hasStaffPermission('staff.delete'), staffPortalController.deleteStaff);

// ─── Staff Portal — Roles (staff JWT, permission-gated) ──────────────────────
router.get('/staff/portal/roles',              isStaffAuthenticated, hasStaffPermission('roles.view'),   staffPortalController.getRoles);
router.get('/staff/portal/roles/:id',          isStaffAuthenticated, hasStaffPermission('roles.view'),   staffPortalController.getRoleById);
router.post('/staff/portal/roles',             isStaffAuthenticated, hasStaffPermission('roles.create'), staffPortalController.createRole);
router.put('/staff/portal/roles/:id',          isStaffAuthenticated, hasStaffPermission('roles.edit'),   staffPortalController.updateRole);
router.delete('/staff/portal/roles/:id',       isStaffAuthenticated, hasStaffPermission('roles.delete'), staffPortalController.deleteRole);
router.put('/staff/portal/roles/:id/permissions', isStaffAuthenticated, hasStaffPermission('roles.edit'), staffPortalController.assignRolePermissions);

// ─── Staff Portal — Modules & Permissions (view only) ────────────────────────
router.get('/staff/portal/modules',      isStaffAuthenticated, staffPortalController.getModules);
router.get('/staff/portal/permissions',  isStaffAuthenticated, staffPortalController.getPermissions);

// ─── Vendor Clients (vendor JWT) ─────────────────────────────────────────────
router.get('/clients',              isVendorAuthenticated, vendorClientController.getAll);
router.get('/clients/:id',          isVendorAuthenticated, vendorClientController.getById);
router.post('/clients',             isVendorAuthenticated, vendorClientController.create);
router.put('/clients/:id',          isVendorAuthenticated, vendorClientController.update);
router.patch('/clients/:id/status', isVendorAuthenticated, vendorClientController.updateStatus);
router.delete('/clients/:id',       isVendorAuthenticated, vendorClientController.remove);

// ─── Vendor Subscribers (vendor JWT) — footer newsletter email signups ────────
router.get('/subscribers',          isVendorAuthenticated, vendorSubscriberController.getAll);
router.post('/subscribers',         isVendorAuthenticated, vendorSubscriberController.create);
router.put('/subscribers/:id',      isVendorAuthenticated, vendorSubscriberController.update);
router.delete('/subscribers/:id',   isVendorAuthenticated, vendorSubscriberController.remove);

// ─── Vendor Staff (vendor JWT) ────────────────────────────────────────────────
router.get('/staff',              isVendorAuthenticated, vendorStaffController.getAll);
router.get('/staff/:id',          isVendorAuthenticated, vendorStaffController.getById);
router.post('/staff',             isVendorAuthenticated, vendorStaffController.create);
router.put('/staff/:id',          isVendorAuthenticated, vendorStaffController.update);
router.put('/staff/:id/role',     isVendorAuthenticated, vendorStaffController.reassignStaffRole);
router.patch('/staff/:id/status', isVendorAuthenticated, vendorStaffController.updateStatus);
router.delete('/staff/:id',       isVendorAuthenticated, vendorStaffController.remove);

// ─── Vendor Subscription (vendor JWT) ───────────────────────────────────────
router.get('/subscription',                  isVendorAuthenticated, vendorSubscriptionController.getMyPlan);

// ─── Vendor Newsletter (vendor JWT) ──────────────────────────────────────────
router.get('/newsletter/subscribers',          isVendorAuthenticated, vendorNewsletterController.getSubscribers);
router.get('/newsletter/unsubscribers',        isVendorAuthenticated, vendorNewsletterController.getUnsubscribers);
router.get('/newsletter/sends',                isVendorAuthenticated, vendorNewsletterController.getNewsletterSends);
router.get('/newsletter/sent-logs',            isVendorAuthenticated, vendorNewsletterController.getSentLogs);
router.patch('/newsletter/bulk',               isVendorAuthenticated, vendorNewsletterController.bulkUpdateClientType);
router.patch('/newsletter/bulk-ids',           isVendorAuthenticated, vendorNewsletterController.bulkUpdateByIds);
router.patch('/newsletter/:id/client-type',    isVendorAuthenticated, vendorNewsletterController.toggleClientType);
router.post('/newsletter/send',                isVendorAuthenticated, vendorNewsletterController.sendNewsletter);

// ─── Vendor Email Categories (vendor JWT) ────────────────────────────────────
const vendorEmailCategoryController = require('../controllers/vendorEmailCategory.controller');
router.get('/email-categories',        isVendorAuthenticated, vendorEmailCategoryController.getAll);
router.get('/email-categories/:id',    isVendorAuthenticated, vendorEmailCategoryController.getById);
router.post('/email-categories',       isVendorAuthenticated, vendorEmailCategoryController.create);
router.put('/email-categories/:id',    isVendorAuthenticated, vendorEmailCategoryController.update);
router.delete('/email-categories/:id', isVendorAuthenticated, vendorEmailCategoryController.delete);

// ─── Vendor Email Templates (vendor JWT) ─────────────────────────────────────
const vendorEmailTemplateController = require('../controllers/vendorEmailTemplate.controller');
router.get('/email-templates',               isVendorAuthenticated, vendorEmailTemplateController.getAll);
router.get('/email-templates/:id',           isVendorAuthenticated, vendorEmailTemplateController.getById);
router.post('/email-templates',              isVendorAuthenticated, vendorEmailTemplateController.create);
router.put('/email-templates/:id',           isVendorAuthenticated, vendorEmailTemplateController.update);
router.patch('/email-templates/:id/status',  isVendorAuthenticated, vendorEmailTemplateController.updateStatus);
router.delete('/email-templates/:id',        isVendorAuthenticated, vendorEmailTemplateController.delete);



// ─── Admin CRUD (admin JWT) ───────────────────────────────────────────────────
router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/',               hasPermission('vendors.view'),   vendorController.getAll);
router.get('/:id',            hasPermission('vendors.view'),   vendorController.getById);
router.post('/',
    hasPermission('vendors.create'),
    checkApprovalRequired('vendors', 'create', 'vendors'),
    vendorController.create
);
router.put('/:id',
    hasPermission('vendors.edit'),
    checkApprovalRequired('vendors', 'update', 'vendors'),
    vendorController.update
);
router.patch('/:id/status',   hasPermission('vendors.edit'),   vendorController.updateStatus);
router.post('/:id/impersonate', hasPermission('vendors.impersonate'), vendorController.impersonate);
router.delete('/:id',
    hasPermission('vendors.delete'),
    checkApprovalRequired('vendors', 'delete', 'vendors'),
    vendorController.remove
);

module.exports = router;
