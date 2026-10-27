const express = require('express');
const router = express.Router();
const controller = require('../controllers/eventResponsibility.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

/**
 * Admin CRUD for Menu Management → Responsibilities (2026-10-27).
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

router.get('/', hasPermission('event_responsibilities.view'), controller.getAll);
router.get('/:id', hasPermission('event_responsibilities.view'), controller.getById);

router.post('/',
    hasPermission('event_responsibilities.create'),
    checkApprovalRequired('event_responsibilities', 'create', 'event_responsibility'),
    controller.create
);
router.put('/:id',
    hasPermission('event_responsibilities.edit'),
    checkApprovalRequired('event_responsibilities', 'update', 'event_responsibility'),
    controller.update
);
router.patch('/:id/status', hasPermission('event_responsibilities.edit'), controller.updateStatus);
router.delete('/:id',
    hasPermission('event_responsibilities.delete'),
    checkApprovalRequired('event_responsibilities', 'delete', 'event_responsibility'),
    controller.deleteById
);

module.exports = router;
