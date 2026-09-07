const express = require('express');
const router = express.Router();
const controller = require('../controllers/guestRelationshipOption.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

/**
 * Admin CRUD for the "Relationship with Invitor" dropdown.
 *
 * Shaped exactly like eventCategory.routes.js — same middleware order, same
 * approval hooks, and the status toggle deliberately bypasses approval, as it
 * does there and in the menus module.
 *
 * List supports `?event_category_id=` — a number for one category, or the
 * literal `null` for the fallback list, which otherwise has no id to ask for.
 */
router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('guest_relationship_options.view'), controller.getAll);
router.get('/:id', hasPermission('guest_relationship_options.view'), controller.getById);

router.post('/',
    hasPermission('guest_relationship_options.create'),
    checkApprovalRequired('guest_relationship_options', 'create', 'guest_relationship_option'),
    controller.create
);
router.put('/:id',
    hasPermission('guest_relationship_options.edit'),
    checkApprovalRequired('guest_relationship_options', 'update', 'guest_relationship_option'),
    controller.update
);
router.patch('/:id/status', hasPermission('guest_relationship_options.edit'), controller.updateStatus);
router.delete('/:id',
    hasPermission('guest_relationship_options.delete'),
    checkApprovalRequired('guest_relationship_options', 'delete', 'guest_relationship_option'),
    controller.deleteById
);

module.exports = router;
