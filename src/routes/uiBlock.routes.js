const express = require('express');
const router = express.Router();
const uiBlockController = require('../controllers/uiBlock.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('uiblocks.view'), uiBlockController.getUiBlocks);
router.get('/:id', hasPermission('uiblocks.view'), uiBlockController.getUiBlockById);
router.post('/', hasPermission('uiblocks.create'), uiBlockController.createUiBlock);
router.put('/:id', hasPermission('uiblocks.edit'), uiBlockController.updateUiBlock);
router.delete('/:id', hasPermission('uiblocks.delete'), uiBlockController.deleteUiBlock);

module.exports = router;
