const express = require('express');
const router = express.Router();
const controller = require('../controllers/planBadge.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// These three sit before /:id, or they are swallowed as an id.
router.get('/settings', hasPermission('plan_badges.view'), controller.getSettings);
router.get('/summary', hasPermission('plan_badges.view'), controller.getSummary);
router.get('/recommended', hasPermission('plan_badges.view'), controller.getRecommended);

router.get('/', hasPermission('plan_badges.view'), controller.getAll);
router.get('/:id', hasPermission('plan_badges.view'), controller.getById);

// Module-level switches, not a badge — gated on edit, no approval (a reversible
// two-key settings write).
router.put('/settings', hasPermission('plan_badges.edit'), controller.updateSettings);

router.post('/',
    hasPermission('plan_badges.create'),
    checkApprovalRequired('plan_badges', 'create', 'plan_badge'),
    controller.create
);
router.put('/:id',
    hasPermission('plan_badges.edit'),
    checkApprovalRequired('plan_badges', 'update', 'plan_badge'),
    controller.update
);
router.patch('/:id/status', hasPermission('plan_badges.edit'), controller.updateStatus);
router.delete('/:id',
    hasPermission('plan_badges.delete'),
    checkApprovalRequired('plan_badges', 'delete', 'plan_badge'),
    controller.deleteById
);

module.exports = router;
