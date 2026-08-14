const express = require('express');
const router = express.Router();
const controller = require('../controllers/religion.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('religions.view'), controller.getAll);
router.get('/:id', hasPermission('religions.view'), controller.getById);

router.post('/',
    hasPermission('religions.create'),
    checkApprovalRequired('religions', 'create', 'religion'),
    controller.create
);
router.put('/:id',
    hasPermission('religions.edit'),
    checkApprovalRequired('religions', 'update', 'religion'),
    controller.update
);
router.patch('/:id/status', hasPermission('religions.edit'), controller.updateStatus);
router.delete('/:id',
    hasPermission('religions.delete'),
    checkApprovalRequired('religions', 'delete', 'religion'),
    controller.deleteById
);

module.exports = router;
