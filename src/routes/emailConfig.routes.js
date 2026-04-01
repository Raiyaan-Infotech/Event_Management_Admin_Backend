const express = require('express');
const router = express.Router();
const emailConfigController = require('../controllers/emailConfig.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('email_configs.view'), emailConfigController.getAll);
router.get('/:id', hasPermission('email_configs.view'), emailConfigController.getById);
router.post('/', hasPermission('email_configs.create'), checkApprovalRequired('email_configs', 'create', 'email_config'), emailConfigController.create);
router.put('/:id', hasPermission('email_configs.edit'), checkApprovalRequired('email_configs', 'edit', 'email_config'), emailConfigController.update);
router.delete('/:id', hasPermission('email_configs.delete'), checkApprovalRequired('email_configs', 'delete', 'email_config'), emailConfigController.delete);
router.post('/:id/test', hasPermission('email_configs.manage'), emailConfigController.testConnection);
router.get('/:id/debug', hasPermission('email_configs.manage'), emailConfigController.debugConnection);
router.patch('/:id/toggle', hasPermission('email_configs.edit'), emailConfigController.toggleActive);

module.exports = router;