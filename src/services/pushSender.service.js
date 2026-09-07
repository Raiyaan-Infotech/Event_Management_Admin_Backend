const jwt = require('jsonwebtoken');
const axios = require('axios');

const { PushNotificationConfig, ClientDeviceToken } = require('../models');
const logger = require('../utils/logger');

/**
 * Actually delivering a push notification, via FCM HTTP v1.
 *
 * ── WHY THERE IS NO `firebase-admin` DEPENDENCY ─────────────────────────────
 * The SDK's only real job here is turning a service account into a bearer
 * token, and `pushNotificationConfig.service` already does exactly that to
 * power the Test Connection button — sign an RS256 JWT, exchange it at
 * Google's token endpoint. Everything after that is one HTTPS POST per token.
 * Adding a 50MB dependency to repeat work already proven in this codebase was
 * not worth it.
 *
 * ── THE ACCESS TOKEN IS CACHED, AND IT MUST BE ──────────────────────────────
 * Google issues one valid for an hour. Fetching a fresh one per recipient
 * would add a round trip to Google for every single guest — on a 1,000-guest
 * send that is 1,000 avoidable calls, and Google rate-limits them. Cached
 * until 60s before expiry, keyed by config id so switching Firebase projects
 * in the admin panel cannot serve a token for the old one.
 *
 * ── ⚠ FCM HTTP v1 SENDS TO EXACTLY ONE TOKEN PER CALL ───────────────────────
 * There is no `registration_ids` array any more; that was the legacy API,
 * removed in 2024. So a send to 1,000 devices IS 1,000 requests. They run in
 * bounded batches rather than all at once — `Promise.all` over a thousand
 * sockets is how you get ECONNRESET rather than speed.
 *
 * ── WHAT COUNTS AS "DELIVERED" ──────────────────────────────────────────────
 * FCM accepting the message. That is the strongest claim anyone can honestly
 * make from the server: whether the handset displayed it is not reported back
 * by this API at all. Opened and Clicked are OUR numbers, written when the app
 * reports them — see `client_notifications`. The mockup's Delivered column is
 * therefore this acceptance, which is what the user asked for: our own DB
 * record of the send, not a Firebase statistic.
 */

/* ── Access token ─────────────────────────────────────────────────────────── */

/** { configId, token, expiresAt } — see the header for why this is cached. */
let cachedToken = null;

const getAccessToken = async (config) => {
    if (
        cachedToken
        && cachedToken.configId === config.id
        && cachedToken.expiresAt > Date.now() + 60_000
    ) {
        return cachedToken.token;
    }

    const clientEmail = config.client_email;
    const privateKey = config.private_key;
    if (!clientEmail || !privateKey) {
        throw new Error('The active Firebase config has no service account credentials.');
    }

    const now = Math.floor(Date.now() / 1000);
    const signedJwt = jwt.sign(
        {
            iss: clientEmail,
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now,
        },
        privateKey,
        { algorithm: 'RS256' },
    );

    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    params.append('assertion', signedJwt);

    const { data } = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
    });

    if (!data?.access_token) throw new Error('Google did not return an access token.');

    cachedToken = {
        configId: config.id,
        token: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
    };
    return cachedToken.token;
};

/* ── Availability ─────────────────────────────────────────────────────────── */

/**
 * Whether a push CAN be delivered right now, and if not, why in words.
 *
 * Returned to the composer so the screen states the real situation instead of
 * hardcoding an assumption — the same contract `channelState()` uses for
 * WhatsApp and Email in `clientMessage.service`.
 */
const availability = async () => {
    const config = await PushNotificationConfig.findOne({ where: { is_active: true } });

    if (!config) {
        return {
            enabled: false,
            config: null,
            reason: 'No Firebase project is active yet. Your notification is saved and recorded, '
                + 'but it will not be delivered until an administrator activates a Firebase '
                + 'configuration in Settings → Push Notifications.',
        };
    }
    if (!config.client_email || !config.private_key || !config.project_id) {
        return {
            enabled: false,
            config,
            reason: `The active Firebase config "${config.name}" is missing its service account `
                + 'credentials, so notifications cannot be delivered yet.',
        };
    }
    return { enabled: true, config, reason: null };
};

/* ── Payload ──────────────────────────────────────────────────────────────── */

/**
 * The composer's options translated into FCM's message shape.
 *
 * ── ⚠ EVERY VALUE FCM EXPECTS AS A STRING IS SENT AS ONE ────────────────────
 * `data` must be a flat map of strings — a number there is rejected outright,
 * with an error that names the field but not the cause. So every value is
 * String()-ed on the way in, including the ones we generate.
 *
 * ── ANDROID AND APPLE ARE CONFIGURED SEPARATELY ─────────────────────────────
 * They are not alternatives; one message carries both blocks and each platform
 * reads its own. TTL is seconds-with-an-s for Android and a UNIX expiry header
 * for Apple, which is why the same number is written twice in two formats.
 *
 * ── SOUND IS ALWAYS THE DEVICE DEFAULT ──────────────────────────────────────
 * There is no sound option anywhere in the composer, so none is read here. A
 * custom sound must be compiled into the app bundle, and a silent flag is
 * overridden by the guest's own notification settings on both platforms — so
 * the only honest behaviour is the sound the guest chose for themselves.
 * `default_sound` / `sound: 'default'` are therefore unconditional.
 */
const buildMessage = ({ token, title, body, imageUrl, clickAction, deepLink, data, options }) => {
    const o = options || {};
    const ttl = Math.max(0, Math.min(2_419_200, Number(o.ttl_seconds) || 86_400));

    /* Flat string map. Whatever the app needs to route the tap lives here. */
    const dataPayload = {};
    for (const [k, v] of Object.entries(data || {})) {
        if (k && v !== undefined && v !== null) dataPayload[String(k)] = String(v);
    }
    dataPayload.click_action = String(clickAction || 'open_app');
    if (deepLink) dataPayload.deep_link = String(deepLink);

    const message = {
        token,
        notification: {
            title: String(title || '').slice(0, 200),
            body: String(body || '').slice(0, 1000),
            ...(imageUrl ? { image: imageUrl } : {}),
        },
        data: dataPayload,
        android: {
            priority: o.priority === 'normal' ? 'NORMAL' : 'HIGH',
            ttl: `${ttl}s`,
            ...(o.collapse_key ? { collapse_key: String(o.collapse_key) } : {}),
            ...(o.restricted_package_name
                ? { restricted_package_name: String(o.restricted_package_name) }
                : {}),
            notification: {
                // The channel is declared in AndroidManifest.xml. Naming one
                // that does not exist there means Android silently drops the
                // notification on API 26+, so this must stay in step with the
                // manifest's default_notification_channel_id.
                channel_id: 'high_importance_channel',
                default_sound: true,
                ...(imageUrl ? { image: imageUrl } : {}),
            },
        },
        apns: {
            headers: {
                'apns-priority': o.priority === 'normal' ? '5' : '10',
                'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl),
                ...(o.collapse_key ? { 'apns-collapse-id': String(o.collapse_key) } : {}),
            },
            payload: {
                aps: {
                    sound: 'default',
                    // iOS shows the badge on the app icon. The in-app list is
                    // what the user actually asked for; this is the icon.
                    ...(o.badge_mode === 'set' && Number.isFinite(Number(o.badge_value))
                        ? { badge: Number(o.badge_value) }
                        : {}),
                    ...(o.badge_mode === 'clear' ? { badge: 0 } : {}),
                    ...(o.content_available ? { 'content-available': 1 } : {}),
                },
            },
        },
    };

    return message;
};

/* ── Send ─────────────────────────────────────────────────────────────────── */

/** Tokens sent at once. Small enough not to exhaust sockets, large enough to matter. */
const BATCH_SIZE = 25;

/**
 * FCM's answer for one token, reduced to what we store.
 *
 * UNREGISTERED and INVALID_ARGUMENT mean the token is dead — the app was
 * uninstalled, or the token belongs to a different Firebase project. Both are
 * permanent, so the row is deactivated with the reason rather than retried
 * forever on every future send.
 */
const classifyError = (err) => {
    const status = err.response?.status;
    const fcm = err.response?.data?.error;
    const code = fcm?.details?.find((d) => d.errorCode)?.errorCode || fcm?.status || '';

    if (code === 'UNREGISTERED' || status === 404) {
        return { dead: true, reason: 'unregistered', message: 'App was uninstalled or token expired' };
    }
    if (code === 'INVALID_ARGUMENT' || status === 400) {
        return { dead: true, reason: 'invalid', message: fcm?.message || 'Token rejected by Firebase' };
    }
    if (status === 429) {
        return { dead: false, reason: 'rate_limited', message: 'Firebase rate limit reached' };
    }
    return {
        dead: false,
        reason: 'error',
        message: fcm?.message || err.message || 'Delivery failed',
    };
};

/**
 * Deliver one notification to many device tokens.
 *
 * Returns a per-token outcome rather than a single boolean, because the caller
 * writes one `event_messages` row per recipient and every one of them needs
 * its own status and, when it failed, its own reason. A summarised
 * "12 failed" is exactly the number the History screen cannot explain.
 */
const sendToTokens = async (tokens, payload) => {
    const state = await availability();
    if (!state.enabled) {
        return tokens.map((t) => ({
            token: t.token,
            deviceTokenId: t.id,
            ok: false,
            reason: state.reason,
        }));
    }

    const { config } = state;
    let accessToken;
    try {
        accessToken = await getAccessToken(config);
    } catch (err) {
        logger.logError(err);
        return tokens.map((t) => ({
            token: t.token,
            deviceTokenId: t.id,
            ok: false,
            reason: `Firebase authentication failed: ${err.message}`,
        }));
    }

    const url = `https://fcm.googleapis.com/v1/projects/${config.project_id}/messages:send`;
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
    };

    const results = [];
    const deadTokenIds = new Map();

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);
        /* eslint-disable no-await-in-loop */
        const settled = await Promise.all(batch.map(async (t) => {
            try {
                await axios.post(
                    url,
                    { message: buildMessage({ ...payload, token: t.token }) },
                    { headers, timeout: 15_000 },
                );
                return { token: t.token, deviceTokenId: t.id, ok: true, reason: null };
            } catch (err) {
                const info = classifyError(err);
                if (info.dead) deadTokenIds.set(t.id, info.reason);
                return {
                    token: t.token,
                    deviceTokenId: t.id,
                    ok: false,
                    reason: info.message,
                };
            }
        }));
        /* eslint-enable no-await-in-loop */
        results.push(...settled);
    }

    /*
      Dead tokens are retired in ONE update, not one per token. Production is
      ~374ms a query; a loop here would add half a minute to a send that had
      already finished.
    */
    if (deadTokenIds.size) {
        const byReason = new Map();
        for (const [id, reason] of deadTokenIds) {
            if (!byReason.has(reason)) byReason.set(reason, []);
            byReason.get(reason).push(id);
        }
        await Promise.all([...byReason.entries()].map(([reason, ids]) => ClientDeviceToken.update(
            { is_active: false, disabled_reason: reason },
            { where: { id: ids } },
        )));
    }

    return results;
};

module.exports = {
    availability,
    sendToTokens,
    // Exported for the tests — these are the behaviours worth locking.
    buildMessage,
    classifyError,
};
