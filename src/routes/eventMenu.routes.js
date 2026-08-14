const express = require('express');
const router = express.Router();
const controller = require('../controllers/eventMenu.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// Filters: ?search= &event_category_id= &event_type_id= &religion_id=
//          &menu_type=website|mobile &is_active= &page= &limit=
router.get('/', hasPermission('event_menus.view'), controller.getAll);
router.get('/:id', hasPermission('event_menus.view'), controller.getById);

router.post('/',
    hasPermission('event_menus.create'),
    checkApprovalRequired('event_menus', 'create', 'event_menu'),
    controller.create
);
router.put('/:id',
    hasPermission('event_menus.edit'),
    checkApprovalRequired('event_menus', 'update', 'event_menu'),
    controller.update
);

// Status and the four per-platform switches bypass approval — they are
// reversible one-column writes, and the menus module sets the same precedent.
router.patch('/:id/status', hasPermission('event_menus.edit'), controller.updateStatus);
router.patch('/reorder', hasPermission('event_menus.edit'), controller.reorder);
router.patch('/:id/toggle/:field', hasPermission('event_menus.edit'), controller.updateToggle);

router.post('/:id/duplicate',
    hasPermission('event_menus.create'),
    checkApprovalRequired('event_menus', 'create', 'event_menu'),
    controller.duplicate
);

router.delete('/:id',
    hasPermission('event_menus.delete'),
    checkApprovalRequired('event_menus', 'delete', 'event_menu'),
    controller.deleteById
);

module.exports = router;
