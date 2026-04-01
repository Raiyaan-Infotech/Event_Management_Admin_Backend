const express = require('express');
const router = express.Router();
const permissionController = require('../controllers/permission.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('permissions.view'), permissionController.getAll);
router.get('/:id', hasPermission('permissions.view'), permissionController.getById);
router.post('/', hasPermission('permissions.manage'), permissionController.create);
router.put('/:id', hasPermission('permissions.manage'), permissionController.update);
router.delete('/:id', hasPermission('permissions.manage'), permissionController.delete);

module.exports = router;