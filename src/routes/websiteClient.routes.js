const express = require('express');
const router = express.Router();
const controller = require('../controllers/websiteClient.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

/**
 * Admin CRUD for people who signed up on a tenant's public website.
 *
 * The PUBLIC signup endpoint is NOT here — it is mounted under
 * `/api/v1/public/website-clients/register` in the public router, because
 * everything in this file sits behind `isAuthenticated`.
 */
router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('website_clients.view'), controller.getAll);
router.get('/stats', hasPermission('website_clients.view'), controller.getStats);
// After /stats — otherwise "stats" is captured as an :id.
router.get('/:id', hasPermission('website_clients.view'), controller.getById);

router.post(
    '/',
    hasPermission('website_clients.create'),
    checkApprovalRequired('website_clients', 'create', 'website_client'),
    controller.create
);
router.put(
    '/:id',
    hasPermission('website_clients.edit'),
    checkApprovalRequired('website_clients', 'update', 'website_client'),
    controller.update
);
// Status is a reversible one-column write, so it skips approval — same
// precedent the menus and event-menu modules set.
router.patch('/:id/status', hasPermission('website_clients.edit'), controller.updateStatus);
router.delete(
    '/:id',
    hasPermission('website_clients.delete'),
    checkApprovalRequired('website_clients', 'delete', 'website_client'),
    controller.deleteById
);

module.exports = router;
