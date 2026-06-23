const express = require('express');
const router = express.Router();
const colorPaletteController = require('../controllers/colorPalette.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/',    hasPermission('color_palettes.view'),   colorPaletteController.getAll);
router.get('/:id', hasPermission('color_palettes.view'),   colorPaletteController.getById);
router.post('/',   hasPermission('color_palettes.create'), colorPaletteController.create);
router.put('/:id', hasPermission('color_palettes.edit'),   colorPaletteController.update);
router.delete('/:id', hasPermission('color_palettes.delete'), colorPaletteController.remove);

module.exports = router;
