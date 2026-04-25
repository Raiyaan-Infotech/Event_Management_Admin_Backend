const express = require('express');
const router = express.Router();
const multer = require('multer');
const themeController = require('../controllers/theme.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed'), false);
    },
});

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/by-plan/:planId', themeController.getThemeByPlan);
router.get('/', hasPermission('themes.view'), themeController.getThemes);
router.get('/:id', hasPermission('themes.view'), themeController.getThemeById);
router.post('/', hasPermission('themes.create'), themeController.createTheme);
router.put('/:id', hasPermission('themes.edit'), themeController.updateTheme);
router.delete('/:id', hasPermission('themes.delete'), themeController.deleteTheme);
router.post('/:id/preview-image', hasPermission('themes.edit'), (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
        next();
    });
}, themeController.uploadPreviewImage);

module.exports = router;
