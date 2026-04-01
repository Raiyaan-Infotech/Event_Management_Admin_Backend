const paymentService = require('../services/payment.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * GET /api/v1/payments
 * List all payments with pagination and filters
 */
const getAll = asyncHandler(async (req, res) => {
    const result = await paymentService.getAll(req.companyId, req.query);
    logger.logRequest(req, 'Get all payments');
    return ApiResponse.paginated(res, result.payments, result.pagination);
});

/**
 * GET /api/v1/payments/stats
 * Revenue + count stats grouped by status
 */
const getStats = asyncHandler(async (req, res) => {
    const stats = await paymentService.getStats(req.companyId);
    logger.logRequest(req, 'Get payment stats');
    return ApiResponse.success(res, stats);
});

/**
 * GET /api/v1/payments/:id
 * Single payment detail
 */
const getById = asyncHandler(async (req, res) => {
    const payment = await paymentService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Get payment: ${req.params.id}`);
    return ApiResponse.success(res, { payment });
});

/**
 * POST /api/v1/payments
 * Create a new payment record
 */
const create = asyncHandler(async (req, res) => {
    const payment = await paymentService.create(req.body, req.companyId);
    logger.logRequest(req, 'Create payment');
    return ApiResponse.created(res, { payment }, 'Payment created successfully');
});

/**
 * PATCH /api/v1/payments/:id/status
 * Update payment status
 */
const updateStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;
    const payment = await paymentService.updateStatus(req.params.id, status, req.companyId);
    logger.logRequest(req, `Update payment status: ${req.params.id} → ${status}`);
    return ApiResponse.success(res, { payment }, 'Payment status updated');
});

module.exports = { getAll, getStats, getById, create, updateStatus };
