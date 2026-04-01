const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faq.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('faqs.view'), faqController.getFaqs);
router.get('/:id', hasPermission('faqs.view'), faqController.getFaqById);

router.post('/',
    hasPermission('faqs.create'),
    checkApprovalRequired('faqs', 'create', 'faqs'),
    faqController.createFaq
);
router.put('/:id',
    hasPermission('faqs.edit'),
    checkApprovalRequired('faqs', 'update', 'faqs'),
    faqController.updateFaq
);
router.delete('/:id',
    hasPermission('faqs.delete'),
    checkApprovalRequired('faqs', 'delete', 'faqs'),
    faqController.deleteFaq
);

module.exports = router;