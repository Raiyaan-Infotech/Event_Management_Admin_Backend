const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/department.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/',     hasPermission('departments.view'),   departmentController.getAll);
router.get('/:id',  hasPermission('departments.view'),   departmentController.getById);
router.post('/',    hasPermission('departments.create'),  departmentController.create);
router.put('/:id',  hasPermission('departments.edit'),    departmentController.update);
router.delete('/:id', hasPermission('departments.delete'), departmentController.delete);

module.exports = router;
