const express = require('express');
const router = express.Router();
const multer = require('multer');
const mediaController = require('../controllers/media.controller');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');
const { checkApprovalRequired } = require('../middleware/approval');
// Configure multer for memory storage (buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/x-icon',
      'application/pdf',
      'video/mp4',
      'video/webm',
      'audio/mpeg',
      'audio/wav',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`), false);
    }
  },
});

router.use(isAuthenticated);
router.use(extractCompanyContext);

router.get('/files', hasPermission('media.view'), mediaController.listFiles);
router.post('/folder', hasPermission('media.upload'), mediaController.createFolder);
router.post('/upload',
    hasPermission('media.upload'),
    checkApprovalRequired('media', 'upload', 'media'),
    (req, res, next) => {
        upload.single('file')(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ success: false, message: 'File size exceeds the 10MB limit.' });
                }
                return res.status(400).json({ success: false, message: err.message || 'File upload failed.' });
            }
            next();
        });
    },
    mediaController.upload
);

router.post('/upload-multiple',
    hasPermission('media.upload'),
    checkApprovalRequired('media', 'upload', 'media'),
    (req, res, next) => {
        upload.array('files', 10)(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ success: false, message: 'File size exceeds the 10MB limit.' });
                }
                return res.status(400).json({ success: false, message: err.message || 'File upload failed.' });
            }
            next();
        });
    },
    mediaController.uploadMultiple
);
router.post('/rename', hasPermission('media.upload'), mediaController.renameFile);
router.post('/copy', hasPermission('media.upload'), mediaController.copyFile);
router.post('/move', hasPermission('media.upload'), mediaController.moveFile);
router.delete('/',
    hasPermission('media.delete'),
    checkApprovalRequired('media', 'delete', 'media'),
    mediaController.deleteFile
);

module.exports = router;
