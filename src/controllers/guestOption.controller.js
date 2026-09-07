const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * The shared HTTP layer for both guest-registration dropdowns.
 *
 * Same reasoning as guestOption.service.js: two identical controllers would
 * drift, and the difference would show up as one list responding with a
 * different envelope key than the other. Bound per list by `resourceKey`.
 *
 * @param {object} cfg
 * @param {object} cfg.service      the bound service
 * @param {string} cfg.resourceKey  envelope key, e.g. 'option'
 * @param {string} cfg.label        for log lines, e.g. 'relationship option'
 */
const build = ({ service, resourceKey, label }) => {
    const getAll = asyncHandler(async (req, res) => {
        const result = await service.getAll(req.query, req.companyId);
        logger.logRequest(req, `Fetched ${result.data.length} ${label}s`);
        return ApiResponse.paginated(res, result.data, result.pagination);
    });

    const getById = asyncHandler(async (req, res) => {
        const row = await service.getById(req.params.id, req.companyId);
        logger.logRequest(req, `Fetched ${label} ${req.params.id}`);
        return ApiResponse.success(res, { [resourceKey]: row });
    });

    const create = asyncHandler(async (req, res) => {
        const row = await service.create(req.body, req.user.id, req.companyId);
        logger.logRequest(req, `Created ${label}: ${row.name}`);
        return ApiResponse.success(res, { [resourceKey]: row }, 'Option created successfully', 201);
    });

    const update = asyncHandler(async (req, res) => {
        const row = await service.update(req.params.id, req.body, req.user.id, req.companyId);
        logger.logRequest(req, `Updated ${label} ${req.params.id}`);
        return ApiResponse.success(res, { [resourceKey]: row }, 'Option updated successfully');
    });

    const updateStatus = asyncHandler(async (req, res) => {
        const row = await service.updateStatus(
            req.params.id,
            req.body.is_active,
            req.user.id,
            req.companyId,
        );
        logger.logRequest(req, `Updated status for ${label} ${req.params.id}`);
        return ApiResponse.success(res, { [resourceKey]: row }, 'Option status updated successfully');
    });

    const deleteById = asyncHandler(async (req, res) => {
        await service.deleteById(req.params.id, req.user.id, req.companyId);
        logger.logRequest(req, `Deleted ${label} ${req.params.id}`);
        return ApiResponse.success(res, null, 'Option deleted successfully');
    });

    return { getAll, getById, create, update, updateStatus, deleteById };
};

module.exports = { build };
