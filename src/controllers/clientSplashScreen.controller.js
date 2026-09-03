const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const service = require('../services/clientSplashScreen.service');

/**
 * Splash Screens — the client portal's standalone splash/loading-screen
 * builder. See the service/model headers: not yet tied to an event.
 */

const list = asyncHandler(async (req, res) => {
    const { rows, pagination } = await service.listSplashScreens(req.websiteClient.id, req.query);
    return ApiResponse.paginated(res, rows, pagination, 'Splash screens retrieved');
});

const getOne = asyncHandler(async (req, res) => {
    const splash = await service.getSplashScreenById(req.websiteClient.id, req.params.id);
    if (!splash) throw ApiError.notFound('Splash screen not found.');
    return ApiResponse.success(res, { splash_screen: splash }, 'Splash screen retrieved');
});

const create = asyncHandler(async (req, res) => {
    const splash = await service.createSplashScreen(
        req.websiteClient.id,
        req.websiteClient.company_id,
        req.body,
    );
    logger.logRequest(req, `Splash screen created: ${splash.id}`);
    return ApiResponse.created(res, { splash_screen: splash }, 'Splash screen created successfully');
});

const update = asyncHandler(async (req, res) => {
    const splash = await service.updateSplashScreen(req.websiteClient.id, req.params.id, req.body);
    if (!splash) throw ApiError.notFound('Splash screen not found.');
    return ApiResponse.success(res, { splash_screen: splash }, 'Splash screen updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    const result = await service.deleteSplashScreen(req.websiteClient.id, req.params.id);
    if (!result) throw ApiError.notFound('Splash screen not found.');
    return ApiResponse.success(res, result, 'Splash screen deleted');
});

/** One file (image/video/audio) → its stored URL. See the service header. */
const uploadMedia = asyncHandler(async (req, res) => {
    const result = await service.uploadMedia(req.websiteClient.company_id, req.file);
    return ApiResponse.success(res, result, 'File uploaded');
});

module.exports = { list, getOne, create, update, remove, uploadMedia };
