const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const clientPortalService = require('../services/clientPortal.service');

/**
 * The signed-in client's own profile plus the plan assigned to them.
 * Reads req.websiteClient, set by isWebsiteClientAuthenticated.
 */
const me = asyncHandler(async (req, res) => {
    const client = await clientPortalService.getMe(req.websiteClient.id);
    if (!client) throw ApiError.notFound('Account not found.');
    return ApiResponse.success(res, { client }, 'Client profile retrieved');
});

/**
 * Everything the Create Event wizard may offer, narrowed to the client's plan.
 * One request rather than four — all of it derives from the same plan lookup.
 */
const eventOptions = asyncHandler(async (req, res) => {
    const options = await clientPortalService.getEventOptions(req.websiteClient.id);
    return ApiResponse.success(res, options, 'Event options retrieved');
});

/**
 * Replace the client's favourite templates. PUT, not PATCH: the body is the
 * complete new list, not a delta.
 */
const setFavouriteTemplates = asyncHandler(async (req, res) => {
    const ids = await clientPortalService.setFavouriteTemplates(
        req.websiteClient.id,
        req.body?.template_ids
    );
    if (ids === null) throw ApiError.notFound('Account not found.');
    return ApiResponse.success(res, { favourite_templates: ids }, 'Favourites updated');
});

module.exports = { me, eventOptions, setFavouriteTemplates };
