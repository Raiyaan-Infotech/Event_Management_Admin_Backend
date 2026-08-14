const express = require('express');
const router = express.Router();
const controller = require('../controllers/eventType.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// ?event_category_id=<id> narrows the list — used by the Menu form's cascading
// Event Type dropdown.
router.get('/', hasPermission('event_types.view'), controller.getAll);
router.get('/:id', hasPermission('event_types.view'), controller.getById);

router.post('/',
    hasPermission('event_types.create'),
    checkApprovalRequired('event_types', 'create', 'event_type'),
    controller.create
);
router.put('/:id',
    hasPermission('event_types.edit'),
    checkApprovalRequired('event_types', 'update', 'event_type'),
    controller.update
);
router.patch('/:id/status', hasPermission('event_types.edit'), controller.updateStatus);
router.delete('/:id',
    hasPermission('event_types.delete'),
    checkApprovalRequired('event_types', 'delete', 'event_type'),
    controller.deleteById
);

module.exports = router;
