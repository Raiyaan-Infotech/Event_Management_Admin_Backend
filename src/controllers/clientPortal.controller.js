const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const clientPortalService = require('../services/clientPortal.service');
const mediaService = require('../services/media.service');

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

/**
 * Inline one of OUR uploaded files as a data URI, for the invitation download.
 *
 * ── WHY THE CLIENT PORTAL NEEDS ITS OWN ──────────────────────────────────────
 * `GET /media/proxy` does exactly this, but sits behind `isAuthenticated` — the
 * ADMIN token. A website client has a different session entirely, so it is 401
 * to them. This is the same service call under the client's own guard.
 *
 * ── WHY A PROXY IS NEEDED AT ALL ─────────────────────────────────────────────
 * The storage bucket sends no `Access-Control-Allow-Origin`, so a `<canvas>`
 * that has drawn the frame or a decoration straight from its CDN URL is
 * "tainted" and refuses `toDataURL()`. The browser cannot fetch the image
 * itself to work around it either. The server has no such restriction.
 *
 * `readAsDataUri` is SSRF-guarded: it accepts only the configured storage base
 * or a URL already sitting on one of our own decoration / frame / template
 * rows, and refuses internal hosts outright. It grants a client nothing that a
 * plain fetch of the file's own URL would not already give them.
 */
const proxyImage = asyncHandler(async (req, res) => {
    const result = await mediaService.readAsDataUri(
        req.query.url,
        req.websiteClient.company_id ?? 1
    );
    return ApiResponse.success(res, result);
});

module.exports = { me, eventOptions, setFavouriteTemplates, proxyImage };
