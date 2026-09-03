const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const clientPortalService = require('../services/clientPortal.service');
const mediaService = require('../services/media.service');
const logger = require('../utils/logger');
const { clearWebsiteClientCookies } = require('../middleware/websiteClientAuth');
const sessionService = require('../services/clientSession.service');

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


// ── Self-service account management ──────────────────────────────────────────
//
// The client id comes from `req.websiteClient` — the session — in every one of
// these. None of them accepts an id, which is what makes them impossible to
// aim at another account.

/** Update the signed-in client's own profile. */
const updateMe = asyncHandler(async (req, res) => {
    const client = await clientPortalService.updateMe(req.websiteClient.id, req.body);
    logger.logRequest(req, `Client profile updated: ${req.websiteClient.id}`);
    return ApiResponse.success(res, { client }, 'Profile updated');
});

/**
 * Change the signed-in client's password.
 *
 * ⚠ EVERY OTHER SESSION IS SIGNED OUT. Changing a password is what somebody
 * does when they think another person has it, and until sessions were stored
 * this could not be honoured at all — the other device kept its stateless token
 * and stayed signed in for up to seven more days. `website_clients` still has no
 * `password_changed_at` column (unlike every other portal's table), so this is
 * done by revoking the rows rather than by comparing token timestamps.
 *
 * The caller's own session is spared: signing yourself out of the form you just
 * submitted reads as the change having failed.
 */
const changeMyPassword = asyncHandler(async (req, res) => {
    await clientPortalService.changeMyPassword(req.websiteClient.id, req.body);
    const revoked = await sessionService.revokeAllOthers(
        req.websiteClient.id,
        req.sessionJti,
        'password_change',
    );
    logger.logRequest(req, `Client password changed: ${req.websiteClient.id} (${revoked} sessions revoked)`);
    return ApiResponse.success(res, { signed_out_sessions: revoked }, revoked
        ? `Password updated. You have been signed out on ${revoked} other ${revoked === 1 ? 'device' : 'devices'}.`
        : 'Password updated');
});

/**
 * Close the signed-in client's own account.
 *
 * The session cookies are cleared on the way out. Without that the browser
 * keeps a token for a row that no longer resolves, and the next request reads
 * as a mysterious 401 rather than as "you closed your account".
 */
const deleteMyAccount = asyncHandler(async (req, res) => {
    // The body carries the identity confirmation — a password, or the account's
    // own email address for a social-only client that has none.
    await clientPortalService.deleteMyAccount(req.websiteClient.id, req.body);
    clearWebsiteClientCookies(res);
    logger.logRequest(req, `Client closed their account: ${req.websiteClient.id}`);
    return ApiResponse.success(res, null, 'Your account has been closed');
});


/** Replace the signed-in client's avatar. Multer puts the file on req.file. */
const updateMyAvatar = asyncHandler(async (req, res) => {
    const client = await clientPortalService.updateMyAvatar(req.websiteClient.id, req.file);
    logger.logRequest(req, `Client avatar updated: ${req.websiteClient.id}`);
    return ApiResponse.success(res, { client }, 'Photo updated');
});

/** Clear it. The stored file is left alone — see the service. */
const removeMyAvatar = asyncHandler(async (req, res) => {
    const client = await clientPortalService.removeMyAvatar(req.websiteClient.id);
    return ApiResponse.success(res, { client }, 'Photo removed');
});

module.exports = {
    updateMyAvatar,
    removeMyAvatar,
    updateMe,
    changeMyPassword,
    deleteMyAccount, me, eventOptions, setFavouriteTemplates, proxyImage };
