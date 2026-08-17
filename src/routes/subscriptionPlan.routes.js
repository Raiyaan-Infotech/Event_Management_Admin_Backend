const express = require('express');
const router = express.Router();
const controller = require('../controllers/subscriptionPlan.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// Filters: ?search= &event_category_id= &event_type_id= &religion_id=
//          &plan_type_id= &billing_cycle= &is_active= &page= &limit=
router.get('/', hasPermission('subscription_plans.view'), controller.getAll);
// Before /:id, or "limit-catalog" is swallowed as an id.
router.get('/limit-catalog', hasPermission('subscription_plans.view'), controller.getLimitCatalog);
router.get('/reasons', hasPermission('subscription_plans.view'), controller.getReasons);
router.get('/:id', hasPermission('subscription_plans.view'), controller.getById);

router.post('/',
    hasPermission('subscription_plans.create'),
    checkApprovalRequired('subscription_plans', 'create', 'subscription_plan'),
    controller.create
);
router.put('/:id',
    hasPermission('subscription_plans.edit'),
    checkApprovalRequired('subscription_plans', 'update', 'subscription_plan'),
    controller.update
);

// Status toggle bypasses approval — the list's Status switch is a reversible
// one-column write, same precedent as every other module here.
router.patch('/:id/status', hasPermission('subscription_plans.edit'), controller.updateStatus);

// Deactivate / reactivate carry a reason and stamp who+when. Gated on edit and
// exempt from approval for the same reason the status switch is: reversible.
router.patch('/:id/deactivate', hasPermission('subscription_plans.edit'), controller.deactivate);
router.patch('/:id/reactivate', hasPermission('subscription_plans.edit'), controller.reactivate);

// Delete WITH a recorded reason — the Delete Plan screen. The plain DELETE
// below stays for the list's quick delete.
router.post('/:id/delete',
    hasPermission('subscription_plans.delete'),
    checkApprovalRequired('subscription_plans', 'delete', 'subscription_plan'),
    controller.deleteWithReason
);

router.post('/:id/duplicate',
    hasPermission('subscription_plans.create'),
    checkApprovalRequired('subscription_plans', 'create', 'subscription_plan'),
    controller.duplicate
);

router.delete('/:id',
    hasPermission('subscription_plans.delete'),
    checkApprovalRequired('subscription_plans', 'delete', 'subscription_plan'),
    controller.deleteById
);

module.exports = router;
