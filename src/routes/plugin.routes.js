const express = require('express');
const router = express.Router();
const pluginController = require('../controllers/plugin.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// GET /api/v1/plugins — list all plugins (grouped by category)
router.get('/', hasPermission('plugins.view'), pluginController.getAll);

// GET /api/v1/plugins/:slug — get single plugin + config
router.get('/:slug', hasPermission('plugins.view'), pluginController.getBySlug);

// PUT /api/v1/plugins/:slug/toggle — enable or disable plugin
router.put('/:slug/toggle', hasPermission('plugins.manage'), pluginController.toggle);

module.exports = router;
