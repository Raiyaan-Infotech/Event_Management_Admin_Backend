const decorationService = require('../services/decoration.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const result = await decorationService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} decorations`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

/** The tiles above the list — Total / Active / Inactive / storage used. */
const getStats = asyncHandler(async (req, res) => {
    const stats = await decorationService.getStats(req.companyId);
    logger.logRequest(req, 'Fetched decoration stats');
    return ApiResponse.success(res, { stats });
});

const getById = asyncHandler(async (req, res) => {
    const decoration = await decorationService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched decoration ${req.params.id}`);
    return ApiResponse.success(res, { decoration });
});

const create = asyncHandler(async (req, res) => {
    const decoration = await decorationService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created decoration: ${decoration.name}`);
    return ApiResponse.success(res, { decoration }, 'Decoration uploaded successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const decoration = await decorationService.update(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Updated decoration ${req.params.id}`);
    return ApiResponse.success(res, { decoration }, 'Decoration updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const decoration = await decorationService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for decoration ${req.params.id}`);
    return ApiResponse.success(res, { decoration }, 'Decoration status updated successfully');
});

const reorder = asyncHandler(async (req, res) => {
    const result = await decorationService.reorder(req.body.items, req.user.id, req.companyId);
    logger.logRequest(req, `Reordered ${result.updated} decorations`);
    return ApiResponse.success(res, result, 'Decoration order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await decorationService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted decoration ${req.params.id}`);
    return ApiResponse.success(res, null, 'Decoration deleted successfully');
});

/**
 * The SVG markup plus its palette.
 *
 * The bucket sends no CORS header, so the editor cannot read its own
 * decoration to find out what colours are in it — this is that read, made
 * from the server where the restriction does not apply.
 */
const getSvgSource = asyncHandler(async (req, res) => {
    const result = await decorationService.getSvgSource(req.query.file_url, req.companyId ?? 1);
    return ApiResponse.success(res, result, 'Decoration source loaded');
});

/**
 * Writes a recoloured COPY and returns it. The row is not touched — the caller
 * saves the returned url through the normal update, so a recolour is approved
 * like any other edit rather than through a back door.
 */
const recolor = asyncHandler(async (req, res) => {
    const result = await decorationService.recolor(
        req.body.file_url,
        req.body.color_map,
        { file_name: req.body.file_name },
        req.companyId ?? 1
    );
    logger.logRequest(req, `Recoloured a decoration (${result.replaced} values replaced)`);
    return ApiResponse.success(res, result, 'Decoration recoloured');
});

module.exports = {
    getAll, getStats, getById, create, update, updateStatus, reorder, deleteById,
    getSvgSource, recolor,
};
