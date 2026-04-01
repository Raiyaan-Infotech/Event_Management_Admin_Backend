const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activityLog.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('activity_logs.view'), activityLogController.getAll);
router.get('/user/:userId', hasPermission('activity_logs.view'), activityLogController.getByUser);
router.get('/module/:module', hasPermission('activity_logs.view'), activityLogController.getByModule);
router.delete('/clear', hasPermission('activity_logs.delete'), activityLogController.clearOld);

module.exports = router;