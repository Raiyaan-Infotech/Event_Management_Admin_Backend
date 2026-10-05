const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/templateFont.controller');
const { FORMATS } = require('../services/templateFont.service');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

/**
 * Fonts the admin adds for invitation templates (Templates → Fonts).
 *
 * Gated by the EVENT TEMPLATES permissions rather than slugs of its own: a
 * font exists only to be picked in the template wizard, so whoever may edit a
 * template may manage its fonts — and no new permission rows have to be seeded
 * before the screen can be opened.
 */

// Chosen by extension, not mimetype: browsers report font files as anything
// from `font/ttf` to `application/octet-stream`, so the mimetype says nothing.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (FORMATS[path.extname(file.originalname || '').toLowerCase()]) return cb(null, true);
        return cb(new Error('Upload a TTF, OTF, WOFF or WOFF2 font file.'), false);
    },
});

// ── Public ─────────────────────────────────────────────────────────────────
// The font file, for `@font-face`. Above the auth gate on purpose — see the
// controller.
router.get('/:id/file', controller.file);

// ── Admin ──────────────────────────────────────────────────────────────────
router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/', hasPermission('event_templates.view'), controller.getAll);

router.post('/',
    hasPermission('event_templates.create'),
    (req, res, next) => {
        upload.single('file')(req, res, (err) => {
            if (!err) return next();
            return res.status(400).json({
                success: false,
                message: err.code === 'LIMIT_FILE_SIZE'
                    ? 'The font file is larger than 5MB.'
                    : (err.message || 'Font upload failed.'),
            });
        });
    },
    controller.create
);

router.put('/:id', hasPermission('event_templates.edit'), controller.update);
router.delete('/:id', hasPermission('event_templates.delete'), controller.deleteById);

module.exports = router;
