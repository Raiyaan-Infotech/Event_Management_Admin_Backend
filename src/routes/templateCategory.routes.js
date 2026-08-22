const express = require('express');
const router = express.Router();
const controller = require('../controllers/templateCategory.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// Filters: ?search= &is_active= &page= &limit= &sort_by= &sort_order=

// Declared BEFORE `/:id`, or Express matches it as an id (§196, §220, §228).
router.patch('/reorder', hasPermission('template_categories.edit'), controller.reorder);

router.get('/', hasPermission('template_categories.view'), controller.getAll);
router.get('/:id', hasPermission('template_categories.view'), controller.getById);

router.post('/',
    hasPermission('template_categories.create'),
    checkApprovalRequired('template_categories', 'create', 'template_category'),
    controller.create
);
router.put('/:id',
    hasPermission('template_categories.edit'),
    checkApprovalRequired('template_categories', 'update', 'template_category'),
    controller.update
);

// Status bypasses approval — a reversible one-column write, the same precedent
// the templates and menu catalogues already set.
router.patch('/:id/status', hasPermission('template_categories.edit'), controller.updateStatus);

router.delete('/:id',
    hasPermission('template_categories.delete'),
    checkApprovalRequired('template_categories', 'delete', 'template_category'),
    controller.deleteById
);

module.exports = router;
