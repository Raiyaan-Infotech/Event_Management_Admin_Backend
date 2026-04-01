const express = require('express');
const router = express.Router();
const approvalController = require('../controllers/approval.controller');
const { isAuthenticated, hasMinLevel } = require('../middleware/auth');
const { extractCompanyContext } = require('../middleware/company');

// All routes require authentication and company context
router.use(isAuthenticated);
router.use(extractCompanyContext);

/**
 * @route   GET /api/v1/approvals
 * @desc    Get all approval requests (filtered by company)
 * @access  Authenticated
 */
router.get('/', approvalController.getRequests);

/**
 * @route   GET /api/v1/approvals/pending
 * @desc    Get pending requests count
 * @access  Authenticated
 */
router.get('/pending', approvalController.getPendingCount);

/**
 * @route   GET /api/v1/approvals/:id
 * @desc    Get single approval request
 * @access  Authenticated
 */
router.get('/:id', approvalController.getRequestById);

/**
 * @route   POST /api/v1/approvals
 * @desc    Create approval request
 * @access  Authenticated
 */
router.post('/', approvalController.createRequest);

/**
 * @route   PATCH /api/v1/approvals/:id/approve
 * @desc    Approve request (Super Admin only)
 * @access  Super Admin
 */
router.patch('/:id/approve', hasMinLevel(100), approvalController.approveRequest);

/**
 * @route   PATCH /api/v1/approvals/:id/reject
 * @desc    Reject request (Super Admin only)
 * @access  Super Admin
 */
router.patch('/:id/reject', hasMinLevel(100), approvalController.rejectRequest);

/**
 * @route   DELETE /api/v1/approvals/:id
 * @desc    Cancel request (requester only)
 * @access  Authenticated (requester)
 */
router.delete('/:id', approvalController.cancelRequest);

module.exports = router;
