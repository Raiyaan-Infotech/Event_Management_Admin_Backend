const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const service = require('../services/clientPreferences.service');

/**
 * The client portal's Preferences and Notifications screens.
 *
 * Like the rest of `/client/*`, none of these take an id — they act on
 * `req.websiteClient`, set by the auth middleware, so none can be aimed at
 * somebody else's settings.
 *
 * All three answer with the SAME shape (`getSettings`), including after a
 * write. The screen therefore never has to merge a partial response into its
 * own state, which is where §308's "a refetch mid-edit overwrote what was being
 * typed" came from.
 */

/** Preferences, notification catalogue, allowed options and delivery state. */
const getSettings = asyncHandler(async (req, res) => {
    const settings = await service.getSettings(req.websiteClient);
    return ApiResponse.success(res, settings, 'Settings retrieved');
});

/** Display, locale, master switches and the Do Not Disturb window. */
const updatePreferences = asyncHandler(async (req, res) => {
    const settings = await service.updatePreferences(req.websiteClient, req.body);
    logger.logRequest(req, `Client preferences updated: ${req.websiteClient.id}`);
    return ApiResponse.success(res, settings, 'Preferences saved');
});

/**
 * Notification choices, as a batch.
 *
 * ⚠ Saving these changes what the client has AGREED to, not what they receive —
 * nothing is delivered yet. The response carries `delivery`, so the screen can
 * keep saying so instead of implying the switch did something it did not.
 */
const updateNotifications = asyncHandler(async (req, res) => {
    const settings = await service.updateNotifications(req.websiteClient, req.body);
    logger.logRequest(req, `Client notification prefs updated: ${req.websiteClient.id}`);
    return ApiResponse.success(res, settings, 'Notification settings saved');
});

module.exports = { getSettings, updatePreferences, updateNotifications };
