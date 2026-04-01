const express = require('express');
const router = express.Router();
const moduleController = require('../controllers/module.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('modules.view'), moduleController.getAll);
router.get('/:id', hasPermission('modules.view'), moduleController.getById);
router.post('/', hasPermission('modules.manage'), moduleController.create);
router.put('/:id', hasPermission('modules.manage'), moduleController.update);
router.delete('/:id', hasPermission('modules.manage'), moduleController.delete);
router.post('/:id/permissions', hasPermission('modules.manage'), moduleController.addPermission);

module.exports = router;