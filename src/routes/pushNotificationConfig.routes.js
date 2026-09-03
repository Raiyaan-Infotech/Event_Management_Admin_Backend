const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/pushNotificationConfig.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max for json
});

router.use(isAuthenticated);

router.get('/active', hasPermission('settings.view'), controller.getActive);
router.get('/', hasPermission('settings.view'), controller.getAll);
router.get('/:id', hasPermission('settings.view'), controller.getById);
router.post('/', hasPermission('settings.edit'), upload.single('file'), controller.create);
router.put('/:id', hasPermission('settings.edit'), upload.single('file'), controller.update);
router.delete('/:id', hasPermission('settings.edit'), controller.delete);
router.patch('/:id/toggle', hasPermission('settings.edit'), controller.toggleActive);
router.patch('/:id/active', hasPermission('settings.edit'), controller.toggleActive);
router.post('/:id/test', hasPermission('settings.edit'), controller.testConnection);

module.exports = router;
