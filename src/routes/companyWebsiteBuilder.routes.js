const express = require('express');
const controller = require('../controllers/companyWebsiteBuilder.controller');
const { isAuthenticated } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

const router = express.Router();

// All routes require admin authentication + company context
router.use(isAuthenticated, extractCompanyContext);

// UI Blocks
router.get('/ui-blocks', controller.getUiBlocks);
router.put('/ui-blocks', controller.saveUiBlocks);

// Pricing Settings
router.get('/pricing/settings', controller.getPricingSettings);
router.put('/pricing/settings', controller.savePricingSettings);

// Pricing Plans
router.get('/pricing/plans', controller.getPricingPlans);
router.put('/pricing/plans', controller.savePricingPlans);

// Pricing Matrix Features
router.get('/pricing/matrix-features', controller.getPricingMatrixFeatures);
router.put('/pricing/matrix-features', controller.savePricingMatrixFeatures);

// Features
router.get('/features', controller.getFeatures);
router.post('/features', controller.createFeature);
router.put('/features/:id', controller.updateFeature);
router.delete('/features/:id', controller.deleteFeature);
router.put('/features', controller.replaceFeatures);

// Template Categories
router.get('/templates/categories', controller.getTemplateCategories);
router.post('/templates/categories', controller.createTemplateCategory);
router.put('/templates/categories/:id', controller.updateTemplateCategory);
router.delete('/templates/categories/:id', controller.deleteTemplateCategory);

// Templates
router.get('/templates', controller.getTemplates);
router.get('/templates/:id', controller.getTemplateById);
router.post('/templates', controller.createTemplate);
router.put('/templates/:id', controller.updateTemplate);
router.delete('/templates/:id', controller.deleteTemplate);

// How It Works
router.get('/how-it-works', controller.getHowItWorksSteps);
router.post('/how-it-works', controller.createHowItWorksStep);
router.put('/how-it-works/:id', controller.updateHowItWorksStep);
router.delete('/how-it-works/:id', controller.deleteHowItWorksStep);
router.put('/how-it-works', controller.replaceHowItWorksSteps);

// FAQ Categories
router.get('/faq-categories', controller.getWebsiteFaqCategories);
router.post('/faq-categories', controller.createWebsiteFaqCategory);
router.put('/faq-categories/:id', controller.updateWebsiteFaqCategory);
router.delete('/faq-categories/:id', controller.deleteWebsiteFaqCategory);

// FAQs
router.get('/faqs', controller.getWebsiteFaqs);
router.get('/faqs/:id', controller.getWebsiteFaqById);
router.post('/faqs', controller.createWebsiteFaq);
router.put('/faqs/:id', controller.updateWebsiteFaq);
router.delete('/faqs/:id', controller.deleteWebsiteFaq);

module.exports = router;
