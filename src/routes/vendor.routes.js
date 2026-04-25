const express = require('express');
const router = express.Router();
const multer = require('multer');
const vendorController = require('../controllers/vendor.controller');
const vendorClientController = require('../controllers/vendorClient.controller');
const vendorStaffController = require('../controllers/vendorStaff.controller');
const vendorStaffAuthController = require('../controllers/vendorStaffAuth.controller');
const vendorRoleController = require('../controllers/vendorRole.controller');
const vendorPermissionController = require('../controllers/vendorPermission.controller');
const staffPortalController = require('../controllers/staffPortal.controller');
const vendorPageController = require('../controllers/vendorPage.controller');
const vendorSliderController = require('../controllers/vendorSlider.controller');
const vendorGalleryController = require('../controllers/vendorGallery.controller');
const vendorTestimonialController = require('../controllers/vendorTestimonial.controller');
const vendorNewsletterController = require('../controllers/vendorNewsletter.controller');
const vendorSocialLinkController = require('../controllers/vendorSocialLink.controller');
const { makeController, getEvents: portfolioGetEvents, replaceEvents: portfolioReplaceEvents } = require('../controllers/vendorPortfolioItem.controller');
const portfolioClientCtrl = makeController('client');
const portfolioSponsorCtrl = makeController('sponsor');
const mediaService = require('../services/media.service');
const ApiResponse = require('../utils/apiResponse');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { isVendorAuthenticated } = require('../middleware/vendorAuth');
const { isStaffAuthenticated, hasStaffPermission } = require('../middleware/staffAuth');
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

// ─── Public — UI blocks catalog (no auth, metadata only) ─────────────────────
router.get('/ui-blocks', asyncHandler(async (req, res) => {
    const { UiBlock } = require('../models');
    const blocks = await UiBlock.findAll({
        where: { is_active: 1 },
        attributes: ['block_type', 'label', 'icon', 'description', 'variants'],
        order: [['id', 'ASC']],
        raw: true,
    });
    ApiResponse.success(res, blocks, 'UI blocks catalog retrieved');
}));

// ─── Staff Auth (public) ──────────────────────────────────────────────────────
router.post('/staff/auth/login',             vendorStaffAuthController.staffLogin);
router.post('/staff/auth/forgot-password',   vendorStaffAuthController.staffForgotPassword);
router.post('/staff/auth/verify-reset-otp',  vendorStaffAuthController.staffVerifyResetOTP);
router.post('/staff/auth/reset-password',    vendorStaffAuthController.staffResetPassword);

// ─── Staff Auth (protected — staff JWT) ───────────────────────────────────────
router.post('/staff/auth/logout',           isStaffAuthenticated, vendorStaffAuthController.staffLogout);
router.get('/staff/auth/me',               isStaffAuthenticated, vendorStaffAuthController.staffMe);
router.put('/staff/auth/change-password',  isStaffAuthenticated, vendorStaffAuthController.staffChangePassword);

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

// ─── Vendor Social Links (vendor JWT) ────────────────────────────────────────
router.get('/social-links',              isVendorAuthenticated, vendorSocialLinkController.getAll);
router.get('/social-links/:id',          isVendorAuthenticated, vendorSocialLinkController.getById);
router.post('/social-links',             isVendorAuthenticated, vendorSocialLinkController.create);
router.put('/social-links/:id',          isVendorAuthenticated, vendorSocialLinkController.update);
router.put('/social-links/:id/toggle',   isVendorAuthenticated, vendorSocialLinkController.toggleActive);
router.delete('/social-links/:id',       isVendorAuthenticated, vendorSocialLinkController.remove);

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

// ─── Staff Portal — Website About ─────────────────────────────────────────────
router.get('/staff/portal/website/about', isStaffAuthenticated, hasStaffPermission('website_management.view'),   staffPortalController.getWebsiteAbout);
router.put('/staff/portal/website/about', isStaffAuthenticated, hasStaffPermission('website_management.edit'),   staffPortalController.updateWebsiteAbout);

// ─── Staff Portal — Website Upload ────────────────────────────────────────────
router.post('/staff/portal/website/upload', isStaffAuthenticated, hasStaffPermission('website_management.edit'), (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
        next();
    });
}, asyncHandler(async (req, res) => {
    if (!req.file) return ApiResponse.error(res, 'No file provided', 400);
    const result = await mediaService.upload(req.file, { folder: req.body.folder || 'vendors' }, req.staff.company_id);
    return ApiResponse.success(res, { file: result }, 'File uploaded successfully');
}));

// ─── Staff Portal — Website Pages ─────────────────────────────────────────────
router.get('/staff/portal/pages',        isStaffAuthenticated, hasStaffPermission('website_management.view'),   staffPortalController.getPages);
router.get('/staff/portal/pages/:id',    isStaffAuthenticated, hasStaffPermission('website_management.view'),   staffPortalController.getPageById);
router.post('/staff/portal/pages',       isStaffAuthenticated, hasStaffPermission('website_management.create'), staffPortalController.createPage);
router.put('/staff/portal/pages/:id',    isStaffAuthenticated, hasStaffPermission('website_management.edit'),   staffPortalController.updatePage);
router.delete('/staff/portal/pages/:id', isStaffAuthenticated, hasStaffPermission('website_management.delete'), staffPortalController.deletePage);

// ─── Vendor Clients (vendor JWT) ─────────────────────────────────────────────
router.get('/clients',              isVendorAuthenticated, vendorClientController.getAll);
router.get('/clients/:id',          isVendorAuthenticated, vendorClientController.getById);
router.post('/clients',             isVendorAuthenticated, vendorClientController.create);
router.put('/clients/:id',          isVendorAuthenticated, vendorClientController.update);
router.patch('/clients/:id/status', isVendorAuthenticated, vendorClientController.updateStatus);
router.delete('/clients/:id',       isVendorAuthenticated, vendorClientController.remove);

// ─── Vendor Staff (vendor JWT) ────────────────────────────────────────────────
router.get('/staff',              isVendorAuthenticated, vendorStaffController.getAll);
router.get('/staff/:id',          isVendorAuthenticated, vendorStaffController.getById);
router.post('/staff',             isVendorAuthenticated, vendorStaffController.create);
router.put('/staff/:id',          isVendorAuthenticated, vendorStaffController.update);
router.put('/staff/:id/role',     isVendorAuthenticated, vendorStaffController.reassignStaffRole);
router.patch('/staff/:id/status', isVendorAuthenticated, vendorStaffController.updateStatus);
router.delete('/staff/:id',       isVendorAuthenticated, vendorStaffController.remove);

// ─── Vendor Pages (vendor JWT) ───────────────────────────────────────────────
router.get('/pages',               isVendorAuthenticated, vendorPageController.getAll);
router.get('/pages/:id',           isVendorAuthenticated, vendorPageController.getById);
router.post('/pages',              isVendorAuthenticated, vendorPageController.create);
router.put('/pages/:id',           isVendorAuthenticated, vendorPageController.update);
router.patch('/pages/:id/status',  isVendorAuthenticated, vendorPageController.updateStatus);
router.delete('/pages/:id',        isVendorAuthenticated, vendorPageController.remove);

// ─── Vendor Sliders (vendor JWT) ─────────────────────────────────────────────
router.get('/sliders',              isVendorAuthenticated, vendorSliderController.getAll);
router.get('/sliders/:id',          isVendorAuthenticated, vendorSliderController.getById);
router.post('/sliders',             isVendorAuthenticated, vendorSliderController.create);
router.put('/sliders/:id',          isVendorAuthenticated, vendorSliderController.update);
router.patch('/sliders/:id/status', isVendorAuthenticated, vendorSliderController.updateStatus);
router.delete('/sliders/:id',       isVendorAuthenticated, vendorSliderController.remove);

// ─── Portfolio Clients (vendor JWT) ──────────────────────────────────────────
router.get('/portfolio/clients',              isVendorAuthenticated, portfolioClientCtrl.getAll);
router.get('/portfolio/clients/:id',          isVendorAuthenticated, portfolioClientCtrl.getById);
router.post('/portfolio/clients',             isVendorAuthenticated, portfolioClientCtrl.create);
router.put('/portfolio/clients/:id',          isVendorAuthenticated, portfolioClientCtrl.update);
router.patch('/portfolio/clients/:id/status', isVendorAuthenticated, portfolioClientCtrl.updateStatus);
router.delete('/portfolio/clients/:id',       isVendorAuthenticated, portfolioClientCtrl.remove);

// ─── Portfolio Events (vendor JWT) ───────────────────────────────────────────
router.get('/portfolio/events', isVendorAuthenticated, portfolioGetEvents);
router.put('/portfolio/events', isVendorAuthenticated, portfolioReplaceEvents);

// ─── Portfolio Sponsors (vendor JWT) ─────────────────────────────────────────
router.get('/portfolio/sponsors',              isVendorAuthenticated, portfolioSponsorCtrl.getAll);
router.get('/portfolio/sponsors/:id',          isVendorAuthenticated, portfolioSponsorCtrl.getById);
router.post('/portfolio/sponsors',             isVendorAuthenticated, portfolioSponsorCtrl.create);
router.put('/portfolio/sponsors/:id',          isVendorAuthenticated, portfolioSponsorCtrl.update);
router.patch('/portfolio/sponsors/:id/status', isVendorAuthenticated, portfolioSponsorCtrl.updateStatus);
router.delete('/portfolio/sponsors/:id',       isVendorAuthenticated, portfolioSponsorCtrl.remove);

// ─── Vendor Gallery (vendor JWT) ─────────────────────────────────────────────
router.get('/gallery',               isVendorAuthenticated, vendorGalleryController.getAll);
router.get('/gallery/:id',           isVendorAuthenticated, vendorGalleryController.getById);
router.post('/gallery',              isVendorAuthenticated, vendorGalleryController.create);
router.put('/gallery/:id',           isVendorAuthenticated, vendorGalleryController.update);
router.patch('/gallery/:id/status',  isVendorAuthenticated, vendorGalleryController.updateStatus);
router.delete('/gallery/:id',        isVendorAuthenticated, vendorGalleryController.remove);

// ─── Vendor Subscription (vendor JWT) ───────────────────────────────────────
const vendorSubscriptionController = require('../controllers/vendorSubscription.controller');
router.get('/subscription',                 isVendorAuthenticated, vendorSubscriptionController.getMyPlan);
router.get('/subscription/themes/:planId', isVendorAuthenticated, vendorSubscriptionController.getThemesByPlan);
router.put('/subscription/theme',          isVendorAuthenticated, vendorSubscriptionController.selectTheme);
router.get('/subscription/colors',         isVendorAuthenticated, vendorSubscriptionController.getColors);
router.put('/subscription/colors',         isVendorAuthenticated, vendorSubscriptionController.saveColors);
router.get('/home-blocks',                 isVendorAuthenticated, vendorSubscriptionController.getHomeBlocks);

// ─── Vendor Testimonials (vendor JWT) ────────────────────────────────────────
router.get('/testimonials',              isVendorAuthenticated, vendorTestimonialController.getAll);
router.get('/testimonials/:id',          isVendorAuthenticated, vendorTestimonialController.getById);
router.post('/testimonials',             isVendorAuthenticated, vendorTestimonialController.create);
router.put('/testimonials/:id',          isVendorAuthenticated, vendorTestimonialController.update);
router.patch('/testimonials/:id/status', isVendorAuthenticated, vendorTestimonialController.updateStatus);
router.delete('/testimonials/:id',       isVendorAuthenticated, vendorTestimonialController.remove);

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

// ─── Preview endpoints ────────────────────────────────────────────────────────
const { getPreviewData, getMyPreviewData } = require('../controllers/vendorPreview.controller');
router.get('/auth/preview-data', isVendorAuthenticated, getMyPreviewData);  // vendor's own data
router.get('/:id/preview-data',  getPreviewData);                            // public fallback

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
router.delete('/:id',
    hasPermission('vendors.delete'),
    checkApprovalRequired('vendors', 'delete', 'vendors'),
    vendorController.remove
);

module.exports = router;
