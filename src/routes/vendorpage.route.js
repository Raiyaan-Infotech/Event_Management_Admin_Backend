const vendorPageController = require('../controllers/vendorPage.controller');

// ─── Vendor Pages (vendor JWT) ────────────────────────────────────────────────
router.get('/pages',               isVendorAuthenticated, vendorPageController.getAll);
router.get('/pages/:id',           isVendorAuthenticated, vendorPageController.getById);
router.post('/pages',              isVendorAuthenticated, vendorPageController.create);
router.put('/pages/:id',           isVendorAuthenticated, vendorPageController.update);
router.patch('/pages/:id/status', isVendorAuthenticated, vendorPageController.updateStatus);
router.delete('/pages/:id',        isVendorAuthenticated, vendorPageController.remove);