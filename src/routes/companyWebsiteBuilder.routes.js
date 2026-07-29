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
router.patch('/pricing/plans/:id/status', controller.updatePricingPlanStatus);
router.put('/pricing/plans/:id/status', controller.updatePricingPlanStatus);
router.delete('/pricing/plans/:id', controller.deletePricingPlan);

// Pricing Matrix Features
router.get('/pricing/matrix-features', controller.getPricingMatrixFeatures);
router.put('/pricing/matrix-features', controller.savePricingMatrixFeatures);

// Features
router.get('/features', controller.getFeatures);
router.post('/features', controller.createFeature);
router.put('/features', controller.replaceFeatures);
router.put('/features/:id', controller.updateFeature);
router.patch('/features/:id/status', controller.updateFeatureStatus);
router.put('/features/:id/status', controller.updateFeatureStatus);
router.delete('/features/:id', controller.deleteFeature);

// Template Categories
router.get('/templates/categories', controller.getTemplateCategories);
router.post('/templates/categories', controller.createTemplateCategory);
router.put('/templates/categories/:id', controller.updateTemplateCategory);
router.patch('/templates/categories/:id/status', controller.updateTemplateCategoryStatus);
router.put('/templates/categories/:id/status', controller.updateTemplateCategoryStatus);
router.delete('/templates/categories/:id', controller.deleteTemplateCategory);

// Templates
router.get('/templates', controller.getTemplates);
router.get('/templates/:id', controller.getTemplateById);
router.post('/templates', controller.createTemplate);
router.put('/templates/:id', controller.updateTemplate);
router.patch('/templates/:id/status', controller.updateTemplateStatus);
router.put('/templates/:id/status', controller.updateTemplateStatus);
router.delete('/templates/:id', controller.deleteTemplate);

// How It Works
router.get('/how-it-works', controller.getHowItWorksSteps);
router.post('/how-it-works', controller.createHowItWorksStep);
router.put('/how-it-works', controller.replaceHowItWorksSteps);
router.put('/how-it-works/:id', controller.updateHowItWorksStep);
router.patch('/how-it-works/:id/status', controller.updateHowItWorksStepStatus);
router.put('/how-it-works/:id/status', controller.updateHowItWorksStepStatus);
router.delete('/how-it-works/:id', controller.deleteHowItWorksStep);

// FAQ Categories
router.get('/faq-categories', controller.getWebsiteFaqCategories);
router.post('/faq-categories', controller.createWebsiteFaqCategory);
router.put('/faq-categories/:id', controller.updateWebsiteFaqCategory);
router.patch('/faq-categories/:id/status', controller.updateWebsiteFaqCategoryStatus);
router.put('/faq-categories/:id/status', controller.updateWebsiteFaqCategoryStatus);
router.delete('/faq-categories/:id', controller.deleteWebsiteFaqCategory);

// FAQs
router.get('/faqs', controller.getWebsiteFaqs);
router.get('/faqs/:id', controller.getWebsiteFaqById);
router.post('/faqs', controller.createWebsiteFaq);
router.put('/faqs/:id', controller.updateWebsiteFaq);
router.patch('/faqs/:id/status', controller.updateWebsiteFaqStatus);
router.put('/faqs/:id/status', controller.updateWebsiteFaqStatus);
router.delete('/faqs/:id', controller.deleteWebsiteFaq);

router.get('/video-tutorial-categories', controller.getVideoTutorialCategories);
router.post('/video-tutorial-categories', controller.createVideoTutorialCategory);
router.put('/video-tutorial-categories/:id', controller.updateVideoTutorialCategory);
router.patch('/video-tutorial-categories/:id/status', controller.updateVideoTutorialCategoryStatus);
router.put('/video-tutorial-categories/:id/status', controller.updateVideoTutorialCategoryStatus);
router.delete('/video-tutorial-categories/:id', controller.deleteVideoTutorialCategory);

// ── Video Tutorial Sub Categories ──────────────────────────
router.get('/video-tutorial-subcategories', controller.getVideoTutorialSubCategories);
router.post('/video-tutorial-subcategories', controller.createVideoTutorialSubCategory);
router.put('/video-tutorial-subcategories/:id', controller.updateVideoTutorialSubCategory);
router.patch('/video-tutorial-subcategories/:id/status', controller.updateVideoTutorialSubCategoryStatus);
router.put('/video-tutorial-subcategories/:id/status', controller.updateVideoTutorialSubCategoryStatus);
router.delete('/video-tutorial-subcategories/:id', controller.deleteVideoTutorialSubCategory);

// ── Difficulty Levels ───────────────────────────────────────
router.get('/video-tutorial-difficulty-levels', controller.getVideoTutorialDifficultyLevels);
router.post('/video-tutorial-difficulty-levels', controller.createVideoTutorialDifficultyLevel);
router.put('/video-tutorial-difficulty-levels/:id', controller.updateVideoTutorialDifficultyLevel);
router.patch('/video-tutorial-difficulty-levels/:id/status', controller.updateVideoTutorialDifficultyLevelStatus);
router.put('/video-tutorial-difficulty-levels/:id/status', controller.updateVideoTutorialDifficultyLevelStatus);
router.delete('/video-tutorial-difficulty-levels/:id', controller.deleteVideoTutorialDifficultyLevel);

// ── Tutorial Types ──────────────────────────────────────────
router.get('/video-tutorial-types', controller.getVideoTutorialTypes);
router.post('/video-tutorial-types', controller.createVideoTutorialType);
router.put('/video-tutorial-types/:id', controller.updateVideoTutorialType);
router.patch('/video-tutorial-types/:id/status', controller.updateVideoTutorialTypeStatus);
router.put('/video-tutorial-types/:id/status', controller.updateVideoTutorialTypeStatus);
router.delete('/video-tutorial-types/:id', controller.deleteVideoTutorialType);

// ── Video Tutorials (main entity) ──────────────────────────
router.get('/video-tutorials', controller.getVideoTutorials);
router.post('/video-tutorials', controller.createVideoTutorial);
router.get('/video-tutorials/:id', controller.getVideoTutorialById);
router.put('/video-tutorials/:id', controller.updateVideoTutorial);
router.patch('/video-tutorials/:id/status', controller.updateVideoTutorialStatus);
router.put('/video-tutorials/:id/status', controller.updateVideoTutorialStatus);
router.delete('/video-tutorials/:id', controller.deleteVideoTutorial);
module.exports = router;
