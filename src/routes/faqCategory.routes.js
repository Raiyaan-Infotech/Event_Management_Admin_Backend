const express = require('express');
const router = express.Router();
const faqCategoryController = require('../controllers/faqCategory.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('faq_categories.view'), faqCategoryController.getFaqCategories);
router.get('/:id', hasPermission('faq_categories.view'), faqCategoryController.getFaqCategoryById);

router.post('/',
    hasPermission('faq_categories.create'),
    checkApprovalRequired('faq_categories', 'create', 'faq_categories'),
    faqCategoryController.createFaqCategory
);
router.put('/:id',
    hasPermission('faq_categories.edit'),
    checkApprovalRequired('faq_categories', 'update', 'faq_categories'),
    faqCategoryController.updateFaqCategory
);
router.delete('/:id',
    hasPermission('faq_categories.delete'),
    checkApprovalRequired('faq_categories', 'delete', 'faq_categories'),
    faqCategoryController.deleteFaqCategory
);

module.exports = router;