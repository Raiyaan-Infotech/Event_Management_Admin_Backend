const express = require('express');
const router = express.Router();
const controller = require('../controllers/decoration.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');

router.use(isAuthenticated);
router.use(extractCompanyContext);

// Filters: ?search= &type=corner|divider|ornament|top|bottom|motif
//          &file_format=PNG|SVG|JPG|WEBP &is_active= &page= &limit=

// `stats` and `reorder` are declared BEFORE `/:id`, or Express matches them as
// an id and the handler goes looking for decoration number NaN (§196, §220).
router.get('/stats', hasPermission('decorations.view'), controller.getStats);
router.patch('/reorder', hasPermission('decorations.edit'), controller.reorder);

router.get('/', hasPermission('decorations.view'), controller.getAll);
router.get('/:id', hasPermission('decorations.view'), controller.getById);

router.post('/',
    hasPermission('decorations.create'),
    checkApprovalRequired('decorations', 'create', 'decoration'),
    controller.create
);
router.put('/:id',
    hasPermission('decorations.edit'),
    checkApprovalRequired('decorations', 'update', 'decoration'),
    controller.update
);

// Reversible one-column write, so it bypasses approval like the other catalogues.
router.patch('/:id/status', hasPermission('decorations.edit'), controller.updateStatus);

router.delete('/:id',
    hasPermission('decorations.delete'),
    checkApprovalRequired('decorations', 'delete', 'decoration'),
    controller.deleteById
);

module.exports = router;
