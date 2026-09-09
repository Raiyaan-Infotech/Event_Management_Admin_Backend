const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificationCategory.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('notification_categories.view'), controller.getAll);
router.get('/:id', hasPermission('notification_categories.view'), controller.getById);

router.post('/',
    hasPermission('notification_categories.create'),
    checkApprovalRequired('notification_categories', 'create', 'notification_category'),
    controller.create
);
router.put('/:id',
    hasPermission('notification_categories.edit'),
    checkApprovalRequired('notification_categories', 'update', 'notification_category'),
    controller.update
);
router.patch('/:id/status', hasPermission('notification_categories.edit'), controller.updateStatus);
router.delete('/:id',
    hasPermission('notification_categories.delete'),
    checkApprovalRequired('notification_categories', 'delete', 'notification_category'),
    controller.deleteById
);

module.exports = router;
