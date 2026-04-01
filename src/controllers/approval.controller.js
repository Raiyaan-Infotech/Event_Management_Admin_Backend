const approvalService = require('../services/approval.service');

/**
 * Get all approval requests
 * GET /api/v1/approvals
 */
const getRequests = async (req, res) => {
  try {
    const { is_active, module_slug, page, limit } = req.query;
    const companyId = req.companyId;

    const filters = {
      companyId,
      is_active: is_active !== undefined ? parseInt(is_active) : undefined,
      moduleSlug: module_slug,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
    };

    const result = await approvalService.getRequests(filters);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error fetching approval requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approval requests',
      error: error.message,
    });
  }
};

/**
 * Get pending requests count
 * GET /api/v1/approvals/pending
 */
const getPendingCount = async (req, res) => {
  try {
    console.log("genPenfing Company Controller Called");
    const companyId = req.companyId;
    const count = await approvalService.getPendingCount(companyId);

    res.json({
      success: true,
      count,
    });
  } catch (error) {
    console.error('Error fetching pending count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending count',
      error: error.message,
    });
  }
};

/**
 * Get single approval request
 * GET /api/v1/approvals/:id
 */
const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.companyId;

    const request = await approvalService.getRequestById(id, companyId);

    res.json({
      success: true,
      data: request,
    });
  } catch (error) {
    console.error('Error fetching approval request:', error);
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Create approval request
 * POST /api/v1/approvals
 */
const createRequest = async (req, res) => {
  try {
    const {
      module_slug,
      permission_slug,
      action,
      resource_type,
      resource_id,
      request_data,
      old_data,
    } = req.body;

    const requestData = {
      companyId: req.companyId,
      requesterId: req.user.id,
      moduleSlug: module_slug,
      permissionSlug: permission_slug,
      action,
      resourceType: resource_type,
      resourceId: resource_id,
      requestData: request_data,
      oldData: old_data,
    };

    const approvalRequest = await approvalService.createRequest(requestData);

    res.status(201).json({
      success: true,
      message: 'Approval request created successfully',
      data: approvalRequest,
    });
  } catch (error) {
    console.error('Error creating approval request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create approval request',
      error: error.message,
    });
  }
};

/**
 * Approve request
 * PATCH /api/v1/approvals/:id/approve
 */
const approveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { review_notes } = req.body;
    const approverId = req.user.id;

    const { approval, result } = await approvalService.approveRequest(
      id,
      approverId,
      review_notes
    );

    res.json({
      success: true,
      message: 'Request approved and executed successfully',
      data: approval,
      result,
    });
  } catch (error) {
    console.error('Error approving request:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Reject request
 * PATCH /api/v1/approvals/:id/reject
 */
const rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { review_notes } = req.body;
    const approverId = req.user.id;

    const request = await approvalService.rejectRequest(
      id,
      approverId,
      review_notes
    );

    res.json({
      success: true,
      message: 'Request rejected successfully',
      data: request,
    });
  } catch (error) {
    console.error('Error rejecting request:', error);
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Cancel request (by requester)
 * DELETE /api/v1/approvals/:id
 */
const cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const requesterId = req.user.id;

    await approvalService.cancelRequest(id, requesterId);

    res.json({
      success: true,
      message: 'Request cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling request:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getRequests,
  getPendingCount,
  getRequestById,
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
};
