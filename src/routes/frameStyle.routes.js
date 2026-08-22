const express = require('express');
const router = express.Router();
const controller = require('../controllers/frameStyle.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// Filters: ?search= &template_category_id= &status=active|inactive|draft|published
//          &publish_status=draft|published &layout=portrait|landscape|square
//          &page= &limit=

// `stats` is declared BEFORE `/:id`, or Express matches it as an id and the
// handler goes looking for frame style number NaN (§196, §220, §228).
router.get('/stats', hasPermission('frame_styles.view'), controller.getStats);

router.get('/', hasPermission('frame_styles.view'), controller.getAll);
router.get('/:id', hasPermission('frame_styles.view'), controller.getById);

router.post('/',
    hasPermission('frame_styles.create'),
    checkApprovalRequired('frame_styles', 'create', 'frame_style'),
    controller.create
);
router.put('/:id',
    hasPermission('frame_styles.edit'),
    checkApprovalRequired('frame_styles', 'update', 'frame_style'),
    controller.update
);

// Reversible one-column write, so it bypasses approval like the other catalogues.
router.patch('/:id/status', hasPermission('frame_styles.edit'), controller.updateStatus);

router.delete('/:id',
    hasPermission('frame_styles.delete'),
    checkApprovalRequired('frame_styles', 'delete', 'frame_style'),
    controller.deleteById
);

module.exports = router;
