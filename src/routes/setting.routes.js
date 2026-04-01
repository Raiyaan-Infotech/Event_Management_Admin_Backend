const express = require('express');
const router = express.Router();
const settingController = require('../controllers/setting.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

// Public route to get public settings (no auth/company context needed)
router.get('/public', settingController.getPublic);

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('settings.view'), settingController.getAll);
router.get('/group/:group', hasPermission('settings.view'), settingController.getByGroup);
router.get('/:key', hasPermission('settings.view'), settingController.getByKey);
router.put('/:key', hasPermission('settings.edit'), checkApprovalRequired('settings', 'edit', 'setting'), settingController.update);
router.post('/bulk', hasPermission('settings.edit'), checkApprovalRequired('settings', 'edit', 'setting'), settingController.bulkUpdate);

module.exports = router;
