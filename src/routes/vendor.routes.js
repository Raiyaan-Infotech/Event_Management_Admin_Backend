const express = require('express');
const router = express.Router();
const multer = require('multer');
const vendorController = require('../controllers/vendor.controller');
const vendorClientController = require('../controllers/vendorClient.controller');
const vendorStaffController = require('../controllers/vendorStaff.controller');
const mediaService = require('../services/media.service');
const ApiResponse = require('../utils/apiResponse');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { isVendorAuthenticated } = require('../middleware/vendorAuth');
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
router.patch('/staff/:id/status', isVendorAuthenticated, vendorStaffController.updateStatus);
router.delete('/staff/:id',       isVendorAuthenticated, vendorStaffController.remove);

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
