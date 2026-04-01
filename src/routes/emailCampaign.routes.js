const express = require('express');
const router = express.Router();
const emailCampaignController = require('../controllers/emailCampaign.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

// All routes require authentication
router.use(isAuthenticated);
router.use(extractCompanyContext);

// Static routes first (before :id routes)
router.get('/holidays', hasPermission('email_campaigns.read'), emailCampaignController.getHolidays);
router.get('/variable-mappings', hasPermission('email_campaigns.read'), emailCampaignController.getVariableMappings);
router.get('/queue/stats', hasPermission('email_campaigns.read'), emailCampaignController.getQueueStats);
router.post('/queue/process', hasPermission('email_campaigns.manage'), emailCampaignController.processQueue);

// CRUD routes
router.get('/', hasPermission('email_campaigns.read'), emailCampaignController.getAll);
router.post('/', hasPermission('email_campaigns.create'), checkApprovalRequired('email_campaigns', 'create', 'email_campaign'), emailCampaignController.create);
router.get('/:id', hasPermission('email_campaigns.read'), emailCampaignController.getById);
router.put('/:id', hasPermission('email_campaigns.update'), checkApprovalRequired('email_campaigns', 'update', 'email_campaign'), emailCampaignController.update);
router.delete('/:id', hasPermission('email_campaigns.delete'), checkApprovalRequired('email_campaigns', 'delete', 'email_campaign'), emailCampaignController.delete);

// Campaign actions
router.get('/:id/statistics', hasPermission('email_campaigns.read'), emailCampaignController.getStatistics);
router.post('/:id/activate', hasPermission('email_campaigns.manage'), emailCampaignController.activate);
router.post('/:id/pause', hasPermission('email_campaigns.manage'), emailCampaignController.pause);
router.post('/:id/trigger', hasPermission('email_campaigns.manage'), emailCampaignController.trigger);

module.exports = router;