const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendor.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { isVendorAuthenticated } = require('../middleware/vendorAuth');
const { checkApprovalRequired } = require('../middleware/approval');

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
