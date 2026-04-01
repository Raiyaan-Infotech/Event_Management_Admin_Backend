const express = require('express');
const router = express.Router();
const translationController = require('../controllers/translation.controller');
const { isAuthenticated } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

// Public routes (for frontend to fetch translations)
router.get('/stats', translationController.getStats);
router.get('/groups', translationController.getGroups);
router.get('/export', translationController.exportAll);

// Public route for reporting missing keys (called by frontend automatically)
router.post('/report-missing', translationController.reportMissingKey);

// Missing keys routes (public count, protected list) - MUST be before dynamic :langCode routes
router.get('/missing/count', translationController.getMissingKeysCount);

// Protected routes for missing keys management
router.get('/missing', isAuthenticated, extractCompanyContext, translationController.getMissingKeys);
router.post('/missing/create-all', isAuthenticated, extractCompanyContext, translationController.createAllMissingKeys);
router.post('/missing/:id/create', isAuthenticated, extractCompanyContext, translationController.createKeyFromMissing);
router.post('/missing/:id/ignore', isAuthenticated, extractCompanyContext, translationController.ignoreMissingKey);
router.delete('/missing/:id', isAuthenticated, extractCompanyContext, translationController.deleteMissingKey);

// Dynamic language routes - MUST be LAST (after all static routes)
router.get('/:langCode/:group', translationController.getTranslationsByGroup);
router.get('/:langCode', translationController.getTranslationsForLanguage);

// Other protected routes
router.post('/translate-all', isAuthenticated, extractCompanyContext, translationController.translateAllToLanguage);

module.exports = router;
