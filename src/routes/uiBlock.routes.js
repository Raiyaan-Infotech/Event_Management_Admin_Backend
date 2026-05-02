const express = require('express');
const router = express.Router();
const multer = require('multer');
const uiBlockController = require('../controllers/uiBlock.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { asyncHandler } = require('../utils/helpers');
const mediaService = require('../services/media.service');
const ApiResponse = require('../utils/apiResponse');
const { UiBlock } = require('../models');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are allowed'), false);
    },
});

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('ui_blocks.view'), uiBlockController.getUiBlocks);
router.get('/:id', hasPermission('ui_blocks.view'), uiBlockController.getUiBlockById);
router.post('/', hasPermission('ui_blocks.create'), uiBlockController.createUiBlock);
router.put('/:id', hasPermission('ui_blocks.edit'), uiBlockController.updateUiBlock);
router.delete('/:id', hasPermission('ui_blocks.delete'), uiBlockController.deleteUiBlock);

router.post('/:id/variants/:variantKey/preview-image',
    hasPermission('ui_blocks.edit'),
    (req, res, next) => upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        next();
    }),
    asyncHandler(async (req, res) => {
        if (!req.file) return ApiResponse.error(res, 'No file provided', 400);
        const block = await UiBlock.findByPk(req.params.id);
        if (!block) return ApiResponse.error(res, 'UI block not found', 404);

        const result = await mediaService.upload(req.file, { folder: 'ui-blocks' }, req.companyId);

        const variants = Array.isArray(block.variants) ? block.variants : [];
        const updated = variants.map(v =>
            (v.key || v) === req.params.variantKey
                ? { key: v.key || v, label: v.label || v.key || v, preview_image: result.url }
                : v
        );
        await block.update({ variants: updated });
        ApiResponse.success(res, { preview_image: result.url }, 'Variant preview uploaded');
    })
);

module.exports = router;
