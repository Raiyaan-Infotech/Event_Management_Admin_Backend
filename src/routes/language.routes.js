const express = require('express');
const router = express.Router();
const languageController = require('../controllers/language.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

// Public route
router.get('/active', languageController.getActive);

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('languages.view'), languageController.getAll);
router.get('/:id', hasPermission('languages.view'), languageController.getById);
router.post('/', hasPermission('languages.create'), checkApprovalRequired('languages', 'create', 'language'), languageController.create);
router.put('/:id', hasPermission('languages.edit'), checkApprovalRequired('languages', 'edit', 'language'), languageController.update);
router.delete('/:id', hasPermission('languages.delete'), checkApprovalRequired('languages', 'delete', 'language'), languageController.delete);
router.patch('/:id/default', hasPermission('languages.edit'), languageController.setDefault);

module.exports = router;
