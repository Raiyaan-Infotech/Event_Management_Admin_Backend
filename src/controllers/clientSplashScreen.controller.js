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

/**
 * The splash the mobile app should show as one event opens.
 *
 * ⚠ 200 with `splash_screen: null` when the event has none, rather than a 404.
 * "This event has no splash" is a normal answer the app acts on by going
 * straight into the event; a 404 would make the app treat an ordinary event as
 * a failure, and it cannot tell the two apart from the status code alone.
 *
 * Viewer-scoped, unlike the rest of this module: the event's owner AND a guest
 * who joined it by QR can read it, because guests are who a splash is for. The
 * host-only fields are stripped — see `getActiveSplashForEvent`.
 */
const forEvent = asyncHandler(async (req, res) => {
    const splash = await service.getActiveSplashForEvent(
        req.websiteClient.id,
        req.params.eventId,
    );
    return ApiResponse.success(res, { splash_screen: splash ?? null }, 'Splash screen retrieved');
});

module.exports = { list, getOne, create, update, remove, uploadMedia, forEvent };
