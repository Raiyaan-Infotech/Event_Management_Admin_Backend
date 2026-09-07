const express = require('express');
const router = express.Router();
const controller = require('../controllers/guestFoodPreferenceOption.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

/**
 * Admin CRUD for the "Food Preference" dropdown. Mirrors
 * guestRelationshipOption.routes.js exactly — see that file's header.
 */
router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('guest_food_preference_options.view'), controller.getAll);
router.get('/:id', hasPermission('guest_food_preference_options.view'), controller.getById);

router.post('/',
    hasPermission('guest_food_preference_options.create'),
    checkApprovalRequired('guest_food_preference_options', 'create', 'guest_food_preference_option'),
    controller.create
);
router.put('/:id',
    hasPermission('guest_food_preference_options.edit'),
    checkApprovalRequired('guest_food_preference_options', 'update', 'guest_food_preference_option'),
    controller.update
);
router.patch('/:id/status', hasPermission('guest_food_preference_options.edit'), controller.updateStatus);
router.delete('/:id',
    hasPermission('guest_food_preference_options.delete'),
    checkApprovalRequired('guest_food_preference_options', 'delete', 'guest_food_preference_option'),
    controller.deleteById
);

module.exports = router;
