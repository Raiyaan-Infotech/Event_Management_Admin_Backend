const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificationTemplate.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

// The optional template image is uploaded via the shared /media/upload
// endpoint first; these routes only ever see the resulting URL string.
router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('notification_templates.view'), controller.getAll);
router.get('/variables', hasPermission('notification_templates.view'), controller.getVariables);
router.get('/system-triggers', hasPermission('notification_templates.view'), controller.getSystemTriggers);
router.get('/:id', hasPermission('notification_templates.view'), controller.getById);

router.post('/',
    hasPermission('notification_templates.create'),
    checkApprovalRequired('notification_templates', 'create', 'notification template'),
    controller.create
);
router.put('/:id',
    hasPermission('notification_templates.edit'),
    checkApprovalRequired('notification_templates', 'update', 'notification template'),
    controller.update
);
router.patch('/:id/status', hasPermission('notification_templates.edit'), controller.updateStatus);
router.post('/:id/duplicate', hasPermission('notification_templates.create'), controller.duplicate);
router.delete('/:id',
    hasPermission('notification_templates.delete'),
    checkApprovalRequired('notification_templates', 'delete', 'notification template'),
    controller.deleteById
);

module.exports = router;
