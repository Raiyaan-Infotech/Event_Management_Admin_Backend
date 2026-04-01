const express = require('express');
const router = express.Router();
const translationController = require('../controllers/translation.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// Translation Keys CRUD
router.get('/', hasPermission('translations.view'), translationController.getAllKeys);
router.post('/', hasPermission('translations.create'), checkApprovalRequired('translations', 'create', 'translation_key'), translationController.createKey);
router.post('/bulk-import', hasPermission('translations.create'), checkApprovalRequired('translations', 'create', 'translation_key'), translationController.bulkImport);
router.get('/:id', hasPermission('translations.view'), translationController.getKeyById);
router.put('/:id', hasPermission('translations.edit'), checkApprovalRequired('translations', 'edit', 'translation_key'), translationController.updateKey);
router.delete('/:id', hasPermission('translations.delete'), checkApprovalRequired('translations', 'delete', 'translation_key'), translationController.deleteKey);

// Translations for a specific key
router.get('/:id/translations', hasPermission('translations.view'), translationController.getKeyTranslations);
router.put('/:id/translations', hasPermission('translations.edit'), checkApprovalRequired('translations', 'edit', 'translation_key'), translationController.updateKeyTranslations);
router.post('/:id/retranslate', hasPermission('translations.manage'), translationController.retranslateKey);
router.post('/:id/retranslate-all', hasPermission('translations.manage'), translationController.retranslateKeyToAll);

module.exports = router;
