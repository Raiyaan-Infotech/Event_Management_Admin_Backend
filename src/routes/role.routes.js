const express = require('express');
const router = express.Router();
const roleController = require('../controllers/role.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('roles.view'), roleController.getAll);
router.get('/:id', hasPermission('roles.view'), roleController.getById);
router.post('/', hasPermission('roles.manage'), checkApprovalRequired('roles', 'create', 'role'), roleController.create);
router.put('/:id', hasPermission('roles.manage'), checkApprovalRequired('roles', 'update', 'role'), roleController.update);
router.delete('/:id', hasPermission('roles.manage'), checkApprovalRequired('roles', 'delete', 'role'), roleController.delete);
router.post('/:id/permissions', hasPermission('roles.manage'), roleController.assignPermissions);

module.exports = router;