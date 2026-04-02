const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menu.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('menus.view'), menuController.getAll);
router.get('/:id', hasPermission('menus.view'), menuController.getById);

router.post('/',
    hasPermission('menus.create'),
    checkApprovalRequired('menus', 'create', 'menus'),
    menuController.create
);
router.put('/:id',
    hasPermission('menus.edit'),
    checkApprovalRequired('menus', 'update', 'menus'),
    menuController.update
);
// Status toggles bypass approval
router.patch('/:id/status', hasPermission('menus.edit'), menuController.updateStatus);
router.patch('/:id/display-status', hasPermission('menus.edit'), menuController.updateDisplayStatus);
router.delete('/:id',
    hasPermission('menus.delete'),
    checkApprovalRequired('menus', 'delete', 'menus'),
    menuController.deleteById
);

module.exports = router;
