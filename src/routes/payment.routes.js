const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated, extractCompanyContext);

// Stats (before /:id so it doesn't get caught)
router.get('/stats', hasPermission('payments.view'), paymentController.getStats);

// CRUD
router.get('/', hasPermission('payments.view'), paymentController.getAll);
router.get('/:id', hasPermission('payments.view'), paymentController.getById);
router.post('/', hasPermission('payments.create'), paymentController.create);
router.patch('/:id/status', hasPermission('payments.manage'), paymentController.updateStatus);

module.exports = router;
