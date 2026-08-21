const express = require('express');
const router = express.Router();
const controller = require('../controllers/eventTemplate.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// Filters: ?search= &event_category_id= &event_type_id= &religion_id=
//          &style= &status=active|inactive|draft|published &is_featured=
//          &publish_status=draft|published &page= &limit=

// `stats` and `reorder` are declared BEFORE `/:id`, or Express matches them as
// an id and the handler goes looking for template number NaN (§196, §220).
router.get('/stats', hasPermission('event_templates.view'), controller.getStats);

router.patch('/reorder', hasPermission('event_templates.edit'), controller.reorder);

router.get('/', hasPermission('event_templates.view'), controller.getAll);
router.get('/:id', hasPermission('event_templates.view'), controller.getById);

router.post('/',
    hasPermission('event_templates.create'),
    checkApprovalRequired('event_templates', 'create', 'event_template'),
    controller.create
);
router.put('/:id',
    hasPermission('event_templates.edit'),
    checkApprovalRequired('event_templates', 'update', 'event_template'),
    controller.update
);

// Status and Featured bypass approval — they are reversible one-column writes,
// and the menu catalogue sets the same precedent.
router.patch('/:id/status', hasPermission('event_templates.edit'), controller.updateStatus);
router.patch('/:id/featured', hasPermission('event_templates.edit'), controller.updateFeatured);

router.post('/:id/duplicate',
    hasPermission('event_templates.create'),
    checkApprovalRequired('event_templates', 'create', 'event_template'),
    controller.duplicate
);

router.delete('/:id',
    hasPermission('event_templates.delete'),
    checkApprovalRequired('event_templates', 'delete', 'event_template'),
    controller.deleteById
);

module.exports = router;
