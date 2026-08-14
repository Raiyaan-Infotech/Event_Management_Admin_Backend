const express = require('express');
const router = express.Router();
const planTypeController = require('../controllers/planType.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('plan_types.view'), planTypeController.getAll);
router.get('/:id', hasPermission('plan_types.view'), planTypeController.getById);

router.post('/',
    hasPermission('plan_types.create'),
    checkApprovalRequired('plan_types', 'create', 'plan_type'),
    planTypeController.create
);
router.put('/:id',
    hasPermission('plan_types.edit'),
    checkApprovalRequired('plan_types', 'update', 'plan_type'),
    planTypeController.update
);
// Status toggle bypasses approval
router.patch('/:id/status', hasPermission('plan_types.edit'), planTypeController.updateStatus);
router.delete('/:id',
    hasPermission('plan_types.delete'),
    checkApprovalRequired('plan_types', 'delete', 'plan_type'),
    planTypeController.deleteById
);

module.exports = router;
