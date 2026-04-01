const express = require('express');
const router = express.Router();
const currencyController = require('../controllers/currency.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

// Public route
router.get('/active', currencyController.getActive);

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('currencies.view'), currencyController.getAll);
router.get('/:id', hasPermission('currencies.view'), currencyController.getById);
router.post('/', hasPermission('currencies.create'), checkApprovalRequired('currencies', 'create', 'currency'), currencyController.create);
router.put('/:id', hasPermission('currencies.edit'), checkApprovalRequired('currencies', 'edit', 'currency'), currencyController.update);
router.delete('/:id', hasPermission('currencies.delete'), checkApprovalRequired('currencies', 'delete', 'currency'), currencyController.delete);
router.patch('/:id/default', hasPermission('currencies.edit'), currencyController.setDefault);

module.exports = router;
