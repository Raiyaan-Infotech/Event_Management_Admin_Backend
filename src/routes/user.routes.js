const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('employees.view'), userController.getAll);
router.get('/:id', hasPermission('employees.view'), userController.getById);
router.post('/', hasPermission('employees.create'), checkApprovalRequired('employees', 'create', 'employee'), userController.create);
router.put('/:id', hasPermission('employees.edit'), checkApprovalRequired('employees', 'edit', 'employee'), userController.update);
router.delete('/:id', hasPermission('employees.delete'), checkApprovalRequired('employees', 'delete', 'employee'), userController.delete);
router.patch('/:id/status', hasPermission('employees.edit'), userController.updateStatus);

module.exports = router;
