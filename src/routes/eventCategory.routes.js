const express = require('express');
const router = express.Router();
const controller = require('../controllers/eventCategory.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('event_categories.view'), controller.getAll);
router.get('/:id', hasPermission('event_categories.view'), controller.getById);

router.post('/',
    hasPermission('event_categories.create'),
    checkApprovalRequired('event_categories', 'create', 'event_category'),
    controller.create
);
router.put('/:id',
    hasPermission('event_categories.edit'),
    checkApprovalRequired('event_categories', 'update', 'event_category'),
    controller.update
);
// Status toggle bypasses approval, matching the menus module
router.patch('/:id/status', hasPermission('event_categories.edit'), controller.updateStatus);
router.delete('/:id',
    hasPermission('event_categories.delete'),
    checkApprovalRequired('event_categories', 'delete', 'event_category'),
    controller.deleteById
);

module.exports = router;
