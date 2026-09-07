const { ClientDeviceToken } = require('../models');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Where the mobile app tells us how to reach it.
 *
 * ── ⚠ WITHOUT THIS, PUSH CANNOT WORK AT ALL ─────────────────────────────────
 * Firebase can be configured perfectly and every composer field filled in, and
 * a send still reaches nobody, because FCM addresses a DEVICE by its token and
 * nothing else. This endpoint is the only thing that supplies one.
 *
 * ── WHY REGISTER IS A PUT-LIKE UPSERT ───────────────────────────────────────
 * The app re-registers on every launch, and FCM rotates a token whenever the
 * app is restored to a new device or its data is cleared. Inserting each time
 * would grow a row per launch and send the same person the same notification
 * a dozen times. The token is UNIQUE, so registering an existing one refreshes
 * it — including reviving a row that a previous failure had deactivated, which
 * is what happens when somebody reinstalls.
 */

/**
 * POST /client/devices — "here is where to reach me".
 *
 * Called by the app right after sign-in and again whenever FCM hands it a new
 * token. Idempotent by design: sending the same token twice is normal, not an
 * error, and must not be answered with a 409.
 */
const register = asyncHandler(async (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (!token) throw ApiError.badRequest('A device token is required.');
    if (token.length > 255) throw ApiError.badRequest('That device token is not valid.');

    const platform = ['android', 'ios', 'web'].includes(req.body?.platform)
        ? req.body.platform
        : 'android';

    const existing = await ClientDeviceToken.findOne({ where: { token } });

    if (existing) {
        /*
          The token may have belonged to somebody else: one handset, two people
          signing in at different times. FCM's token follows the APP INSTALL,
          not the account, so ownership is reassigned rather than duplicated —
          otherwise the previous owner keeps receiving notifications on a phone
          they no longer use.
        */
        await existing.update({
            website_client_id: req.websiteClient.id,
            platform,
            device_name: req.body?.device_name?.slice(0, 120) || existing.device_name,
            app_version: req.body?.app_version?.slice(0, 40) || existing.app_version,
            is_active: true,
            disabled_reason: null,
            last_seen_at: new Date(),
        });
        logger.logRequest(req, `Device token refreshed (${platform})`);
        return ApiResponse.success(res, { registered: true }, 'Device registered');
    }

    await ClientDeviceToken.create({
        website_client_id: req.websiteClient.id,
        token,
        platform,
        device_name: req.body?.device_name?.slice(0, 120) || null,
        app_version: req.body?.app_version?.slice(0, 40) || null,
        is_active: true,
        last_seen_at: new Date(),
    });

    logger.logRequest(req, `Device token registered (${platform})`);
    return ApiResponse.success(res, { registered: true }, 'Device registered');
});

/**
 * DELETE /client/devices — "stop reaching me here".
 *
 * Called on sign-out. Deactivated rather than deleted, for the same reason a
 * token FCM has rejected is kept: the row explains why a later notification
 * was not delivered to a device the person still owns.
 */
const unregister = asyncHandler(async (req, res) => {
    const token = String(req.body?.token || req.query?.token || '').trim();
    if (!token) throw ApiError.badRequest('A device token is required.');

    await ClientDeviceToken.update(
        { is_active: false, disabled_reason: 'signed_out' },
        { where: { token, website_client_id: req.websiteClient.id } },
    );

    logger.logRequest(req, 'Device token released');
    return ApiResponse.success(res, { released: true }, 'Device released');
});

/** GET /client/devices — what this account can currently be reached on. */
const list = asyncHandler(async (req, res) => {
    const devices = await ClientDeviceToken.findAll({
        where: { website_client_id: req.websiteClient.id },
        attributes: [
            'id', 'platform', 'device_name', 'app_version',
            'is_active', 'disabled_reason', 'last_seen_at', 'created_at',
        ],
        order: [['last_seen_at', 'DESC']],
    });

    return ApiResponse.success(res, {
        devices,
        // What the composer cares about: reachable at all, yes or no.
        push_enabled: devices.some((d) => d.is_active),
    }, 'Devices retrieved');
});

module.exports = { register, unregister, list };
