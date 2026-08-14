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
