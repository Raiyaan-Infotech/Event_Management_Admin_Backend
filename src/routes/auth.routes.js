const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { isAuthenticated } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

// Public routes
// Self-registration DISABLED for multi-tenant SaaS
// Users must be created by higher-authority admins within their company
// router.post('/register', authController.register);

router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-reset-otp', authController.verifyResetOTP);
router.post('/reset-password', authController.resetPassword);

// Protected routes
router.use(isAuthenticated);
router.use(extractCompanyContext);

router.post('/logout', authController.logout);
router.get('/me', authController.me);
router.put('/change-password', authController.changePassword);
router.put('/update-profile', authController.updateProfile);
module.exports = router;