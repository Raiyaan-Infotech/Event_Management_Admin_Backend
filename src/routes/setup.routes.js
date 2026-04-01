const express = require('express');
const multer = require('multer');
const os = require('os');
const { setupGuard } = require('../middleware/setup');
const {
  getStatus,
  preflightCheck,
  testDatabase,
  configure,
  createCompany,
  createAdmin,
  finalize,
} = require('../controllers/setup.controller');

const router = express.Router();

// ─── Multer (temp disk storage — controller moves files to final upload dir) ───
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}-${file.originalname}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB hard limit for setup uploads
  },
  fileFilter: (req, file, cb) => {
    const allowedExt = /jpeg|jpg|png|gif|webp|ico|svg/;
    const allowedMime = /^image\/(jpeg|jpg|png|gif|webp|x-icon|svg\+xml|vnd\.microsoft\.icon)$/;
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (allowedExt.test(ext) || allowedMime.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for logo/favicon/avatar'), false);
    }
  },
});

// ─── Multer error handler wrapper ─────────────────────────────────────────────
const handleMulterError = (uploadMiddleware) => (req, res, next) => {
  uploadMiddleware(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
};

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/setup/status
 * Always public — frontend middleware calls this on cold start.
 * Returns { installed: boolean }
 */
router.get('/status', getStatus);

/**
 * POST /api/v1/setup/check
 * Pre-flight checks: Node version, backend reachable, write permissions.
 * Blocked after install.
 */
router.post('/check', setupGuard, preflightCheck);

/**
 * POST /api/v1/setup/test-db
 * Test MySQL connection credentials before committing.
 * Blocked after install.
 */
router.post('/test-db', setupGuard, testDatabase);

/**
 * POST /api/v1/setup/configure
 * Write .env + create DB + run schema SQL.
 * Blocked after install.
 */
router.post('/configure', setupGuard, configure);

/**
 * POST /api/v1/setup/company
 * Create company, modules, permissions, and settings.
 * Accepts multipart/form-data with optional logo + favicon files.
 * Blocked after install.
 */
router.post(
  '/company',
  setupGuard,
  handleMulterError(upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 },
  ])),
  createCompany
);

/**
 * POST /api/v1/setup/admin
 * Create super admin user + developer role + super admin role.
 * Accepts multipart/form-data with optional avatar file.
 * Blocked after install.
 */
router.post(
  '/admin',
  setupGuard,
  handleMulterError(upload.fields([{ name: 'avatar', maxCount: 1 }])),
  createAdmin
);

/**
 * POST /api/v1/setup/finalize
 * Seed translations + mark installed + set JWT cookies for auto-login.
 * Blocked after install.
 */
router.post('/finalize', setupGuard, finalize);

module.exports = router;