const express = require('express');
const router = express.Router();
const themeController = require('../controllers/theme.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/by-plan/:planId', themeController.getThemeByPlan);
router.get('/', hasPermission('themes.view'), themeController.getThemes);
router.get('/:id', hasPermission('themes.view'), themeController.getThemeById);
router.post('/', hasPermission('themes.create'), themeController.createTheme);
router.put('/:id', hasPermission('themes.edit'), themeController.updateTheme);
router.delete('/:id', hasPermission('themes.delete'), themeController.deleteTheme);

module.exports = router;
