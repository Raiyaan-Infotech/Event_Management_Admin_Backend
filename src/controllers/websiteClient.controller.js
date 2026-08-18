const websiteClientService = require('../services/websiteClient.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

// ── Public: signup from the tenant website ───────────────────────────────────

/**
 * No auth. The tenant is resolved server-side — `x-company-id` / `?vendor_id=`
 * are read through the same optional company context the rest of the public
 * API uses, and fall back to the default vendor.
 */
const register = asyncHandler(async (req, res) => {
    const vendorId = req.body.vendor_id || req.query.vendor_id || req.companyId || undefined;
    const client = await websiteClientService.register(req.body, vendorId, req.companyId ?? null);
    logger.logRequest(req, `Website signup: ${client.email}`);
    return ApiResponse.success(res, { client }, 'Account created successfully', 201);
});

/**
 * No auth, and no session issued — see the service. Answers 401 for bad
 * credentials, which is what the form shows as an inline error.
 */
const login = asyncHandler(async (req, res) => {
    const vendorId = req.body.vendor_id || req.query.vendor_id || req.companyId || undefined;
    const client = await websiteClientService.login(req.body, vendorId);
    logger.logRequest(req, `Website login: ${client.email}`);
    return ApiResponse.success(res, { client }, 'Login successful');
});

// ── Admin ────────────────────────────────────────────────────────────────────

const getAll = asyncHandler(async (req, res) => {
    const result = await websiteClientService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} website clients`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getStats = asyncHandler(async (req, res) => {
    const stats = await websiteClientService.getStats(req.companyId);
    return ApiResponse.success(res, { stats });
});

const getById = asyncHandler(async (req, res) => {
    const client = await websiteClientService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched website client ${req.params.id}`);
    return ApiResponse.success(res, { client });
});

const create = asyncHandler(async (req, res) => {
    const client = await websiteClientService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created website client: ${client.email}`);
    return ApiResponse.success(res, { client }, 'Client created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const client = await websiteClientService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated website client ${req.params.id}`);
    return ApiResponse.success(res, { client }, 'Client updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const client = await websiteClientService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for website client ${req.params.id}`);
    return ApiResponse.success(res, { client }, 'Client status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await websiteClientService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted website client ${req.params.id}`);
    return ApiResponse.success(res, null, 'Client deleted successfully');
});

module.exports = {
    register,
    login,
    getAll,
    getStats,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
