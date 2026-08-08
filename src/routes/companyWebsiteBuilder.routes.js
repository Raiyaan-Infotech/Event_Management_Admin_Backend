const express = require('express');
const controller = require('../controllers/companyWebsiteBuilder.controller');
const translationController = require('../controllers/websiteBuilderTranslation.controller');
const router = express.Router();
const jwt = require('jsonwebtoken');

const optionalCompanyAuth = (req, res, next) => {
  let token = null;
  const authHeader = req.headers.authorization || req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || 'eventinvite_access_secret_key_change_in_production');
      req.user = decoded;
    } catch {
      // ignore expired/invalid token
    }
  }

  const headerCompanyId = req.headers['x-company-id'] || req.query?.company_id;
  let parsedId = parseInt(headerCompanyId, 10);
  if (!parsedId || isNaN(parsedId)) {
    parsedId = req.user?.company_id ? parseInt(req.user.company_id, 10) : 1;
  }
  req.companyId = parsedId && !isNaN(parsedId) ? parsedId : 1;

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please login.' });
    }
  }

  next();
};

router.use(optionalCompanyAuth);

// Website Builder Content Translations (per-section, per-language field values)
router.get('/translations/languages', translationController.getBuilderLanguages);
router.post('/translations/languages', translationController.createBuilderLanguage);
router.put('/translations/languages/:id', translationController.updateBuilderLanguage);
router.patch('/translations/languages/:id/default', translationController.setDefaultBuilderLanguage);
router.post('/translations/languages/:id/translate-all', translationController.translateAllToLanguage);
router.delete('/translations/languages/:id', translationController.deleteBuilderLanguage);
// Whole-site overlay + switcher list, consumed by the rendered website
router.get('/translations/public-languages', translationController.getPublicLanguages);
router.get('/translations/bundle', translationController.getTranslationBundle);
router.get('/content-translations', translationController.getContentTranslations);
router.put('/content-translations', translationController.saveContentTranslations);
router.put('/translation-keys/register', translationController.registerTranslationKeys);
router.get('/translation-keys/sections', translationController.listTranslationSections);
router.get('/translation-keys/stats', translationController.getTranslationStats);
router.get('/translation-keys', translationController.listTranslationKeys);
router.put('/translation-keys/:id/translations', translationController.saveKeyTranslations);
router.post('/translation-keys/:id/retranslate', translationController.retranslateTranslationKey);
router.delete('/translation-keys/:id', translationController.deleteTranslationKey);
router.post('/content-translations/auto-translate', translationController.autoTranslateContent);
// SSE progress stream for the same operation (drives the full-screen loader)
router.get('/content-translations/auto-translate/stream', translationController.autoTranslateContentStream);

// Highlights
router.get('/highlights', controller.getHighlights);
router.put('/highlights', controller.saveHighlights);

// UI Blocks
router.get('/ui-blocks', controller.getUiBlocks);
router.put('/ui-blocks', controller.saveUiBlocks);

// Pricing Settings
router.get('/pricing/settings', controller.getPricingSettings);
router.put('/pricing/settings', controller.savePricingSettings);

// Pricing Plans
router.get('/pricing/plans', controller.getPricingPlans);
router.get('/pricing-plans', controller.getPricingPlans);
router.put('/pricing/plans', controller.savePricingPlans);
router.put('/pricing-plans', controller.savePricingPlans);
// Single-row create/update — the bulk PUT above deletes and reinserts every
// plan on every call, reassigning ids and orphaning translations. The admin
// form uses these instead so editing one plan doesn't touch the others' ids.
router.post('/pricing/plans', controller.createPricingPlan);
router.post('/pricing-plans', controller.createPricingPlan);
router.put('/pricing/plans/:id', controller.updatePricingPlan);
router.put('/pricing-plans/:id', controller.updatePricingPlan);
router.patch('/pricing/plans/:id/status', controller.updatePricingPlanStatus);
router.put('/pricing/plans/:id/status', controller.updatePricingPlanStatus);
router.delete('/pricing/plans/:id', controller.deletePricingPlan);

// Pricing Matrix Features
router.get('/pricing/matrix-features', controller.getPricingMatrixFeatures);
router.put('/pricing/matrix-features', controller.savePricingMatrixFeatures);
// Single-row create/update, same reasoning as pricing plans above.
router.post('/pricing/matrix-features', controller.createPricingMatrixFeature);
router.put('/pricing/matrix-features/:id', controller.updatePricingMatrixFeature);
router.delete('/pricing/matrix-features/:id', controller.deletePricingMatrixFeature);

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

// ── Company-Scoped Website Builder Modules ─────────────────
router.get('/basic-information', controller.getBasicInformation);
router.put('/basic-information', controller.saveBasicInformation);

router.get('/hero-section', controller.getHeroSection);
router.put('/hero-section', controller.saveHeroSection);

router.get('/footer', controller.getFooter);
router.put('/footer', controller.saveFooter);

router.get('/seo', controller.getSeo);
router.put('/seo', controller.saveSeo);

router.get('/login-settings', controller.getLoginSettings);
router.put('/login-settings', controller.saveLoginSettings);

router.get('/theme-settings', controller.getThemeSettings);
router.put('/theme-settings', controller.saveThemeSettings);

router.get('/social-links', controller.listSocialLinks);
router.put('/social-links', controller.saveSocialLinks);

router.get('/pages', controller.listPages);
router.post('/pages', controller.createPage);
router.put('/pages/:id', controller.updatePage);
router.delete('/pages/:id', controller.deletePage);

router.get('/menu-items', controller.listMenuItems);
router.put('/menu-items', controller.saveMenuItems);

router.get('/company-ui-blocks', controller.listCompanyUiBlocks);
router.put('/company-ui-blocks', controller.saveCompanyUiBlocks);

router.get('/sliders', controller.listSliders);
router.post('/sliders', controller.createSlider);
router.put('/sliders/:id', controller.updateSlider);
router.delete('/sliders/:id', controller.deleteSlider);
router.get('/slider-items', controller.listSliderItems);
router.post('/slider-items', controller.createSliderItem);
router.put('/slider-items/:id', controller.updateSliderItem);
router.delete('/slider-items/:id', controller.deleteSliderItem);

router.get('/gallery-categories', controller.listGalleryCategories);
router.post('/gallery-categories', controller.createGalleryCategory);
router.put('/gallery-categories/:id', controller.updateGalleryCategory);
router.delete('/gallery-categories/:id', controller.deleteGalleryCategory);

router.get('/gallery-items', controller.listGalleryItems);
router.post('/gallery-items', controller.createGalleryItem);
router.put('/gallery-items/:id', controller.updateGalleryItem);
router.delete('/gallery-items/:id', controller.deleteGalleryItem);

router.get('/contact-settings', controller.getContactSettings);
router.put('/contact-settings', controller.saveContactSettings);

router.get('/contact-categories', controller.listContactCategories);
router.post('/contact-categories', controller.createContactCategory);
router.put('/contact-categories/:id', controller.updateContactCategory);
router.delete('/contact-categories/:id', controller.deleteContactCategory);

router.get('/contact-messages', controller.listContactMessages);
router.post('/contact-messages', controller.createContactMessage);
router.put('/contact-messages/:id', controller.updateContactMessage);
router.delete('/contact-messages/:id', controller.deleteContactMessage);

router.get('/testimonials', controller.listTestimonials);
router.post('/testimonials', controller.createTestimonial);
router.put('/testimonials', controller.saveTestimonials);
router.put('/testimonials/:id', controller.updateTestimonial);
router.delete('/testimonials/:id', controller.deleteTestimonial);

router.get('/clients', controller.listClients);
router.post('/clients', controller.createClient);
router.put('/clients', controller.saveClients);
router.put('/clients/:id', controller.updateClient);
router.delete('/clients/:id', controller.deleteClient);

router.get('/sponsors', controller.listSponsors);
router.post('/sponsors', controller.createSponsor);
router.put('/sponsors', controller.saveSponsors);
router.put('/sponsors/:id', controller.updateSponsor);
router.delete('/sponsors/:id', controller.deleteSponsor);

module.exports = router;
