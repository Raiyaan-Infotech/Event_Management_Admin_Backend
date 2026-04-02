const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscription.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('subscriptions.view'), subscriptionController.getAll);
router.get('/:id', hasPermission('subscriptions.view'), subscriptionController.getById);

router.post('/',
    hasPermission('subscriptions.create'),
    checkApprovalRequired('subscriptions', 'create', 'subscriptions'),
    subscriptionController.create
);
router.put('/:id',
    hasPermission('subscriptions.edit'),
    checkApprovalRequired('subscriptions', 'update', 'subscriptions'),
    subscriptionController.update
);
// Status toggle bypasses approval
router.patch('/:id/status', hasPermission('subscriptions.edit'), subscriptionController.updateStatus);
router.delete('/:id',
    hasPermission('subscriptions.delete'),
    checkApprovalRequired('subscriptions', 'delete', 'subscriptions'),
    subscriptionController.deleteById
);

module.exports = router;
