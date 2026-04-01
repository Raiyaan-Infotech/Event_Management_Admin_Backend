const express = require('express');
const router = express.Router();
const emailTemplateController = require('../controllers/emailTemplate.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/parts', hasPermission('email_templates.view'), emailTemplateController.getParts);
router.get('/variables', hasPermission('email_templates.view'), emailTemplateController.getVariables);
router.get('/', hasPermission('email_templates.view'), emailTemplateController.getAll);
router.get('/:id', hasPermission('email_templates.view'), emailTemplateController.getById);
router.post('/', hasPermission('email_templates.create'), checkApprovalRequired('email_templates', 'create', 'email_template'), emailTemplateController.create);
router.put('/:id', hasPermission('email_templates.update'), checkApprovalRequired('email_templates', 'update', 'email_template'), emailTemplateController.update);
router.patch('/:id/toggle-active', hasPermission('email_templates.update'), emailTemplateController.toggleActive);
router.delete('/:id', hasPermission('email_templates.delete'), checkApprovalRequired('email_templates', 'delete', 'email_template'), emailTemplateController.delete);
router.post('/:id/preview', hasPermission('email_templates.view'), emailTemplateController.preview);
router.post('/:id/send', hasPermission('email_templates.manage'), emailTemplateController.send);

module.exports = router;