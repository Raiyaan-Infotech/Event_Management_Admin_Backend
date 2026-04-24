const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/uiBlockCategory.controller');
const { isAuthenticated } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', ctrl.getUiBlockCategories);
router.get('/:id', ctrl.getUiBlockCategoryById);
router.post('/', ctrl.createUiBlockCategory);
router.put('/:id', ctrl.updateUiBlockCategory);
router.delete('/:id', ctrl.deleteUiBlockCategory);

module.exports = router;
