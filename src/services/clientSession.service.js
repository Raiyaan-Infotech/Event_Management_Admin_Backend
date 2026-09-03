const { randomUUID } = require('crypto');
const { UAParser } = require('ua-parser-js');
const { Op } = require('sequelize');
const { ClientSession, WebsiteClient, sequelize } = require('../models');
const {
    generateWebsiteClientAccessToken,
    generateWebsiteClientRefreshToken,
    verifyRefreshToken,
} = require('../utils/jwt');
const ApiError = require('../utils/apiError');

/**
 * Website-client sessions — one row per sign-in.
 *
 * ── WHAT THIS UNLOCKS ───────────────────────────────────────────────────────
 * Until this existed, a website client's tokens were stateless JWTs: signed,
 * handed over and forgotten. There was no row to list on an "Active Sessions"
 * screen, and "Log out all other sessions" could not work, because nothing
 * anywhere knew what the other sessions were. Logout cleared a cookie and left
 * the token valid until it expired.
 *
 * ── THE DESIGN IS BORROWED, NOT INVENTED ────────────────────────────────────
 * utils/clientSession.js already does this for the OLDER vendor-client portal:
 * metadata capture, single-use rotation inside a transaction, revoke-one and
 * revoke-all. This follows the same shape. A second, subtly different session
 * design in one codebase is how one of them ends up with the weaker rules.
 *
 * ── ONE TABLE, TWO SCREENS ──────────────────────────────────────────────────
 * Active Sessions and Authorized Devices are these same rows read two ways.
 * See the model header for why that is not two tables.
 */

const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TRUST_DAYS = 30;

/* ── Request metadata ────────────────────────────────────────────────────── */

/**
 * Who is asking, as far as the request can say.
 *
 * ⚠ `location` is NOT derived. The design shows a city per row; there is no
 * GeoIP service in this project, and a city guessed from an IP range would be
 * wrong often enough to matter on the one screen somebody uses to decide
 * whether they recognise a login. The IP is stored and shown instead.
 */
const describeRequest = (req) => {
    const userAgent = req?.get?.('user-agent') || null;
    const parsed = userAgent ? UAParser(userAgent) : null;

    const browser = parsed?.browser?.name || null;
    const os = parsed?.os?.name || null;

    /*
      The Flutter app's HTTP client sends a Dart user-agent that names no device
      at all, so it may send `X-Device-Info: iPhone 14 · iOS 17.4` instead. Read
      it when it is there; never fall back to a guess, because "Unknown device"
      is a true answer and "Windows · Chrome" for a phone is not.
    */
    const declared = req?.get?.('x-device-info')?.slice(0, 120) || null;

    const derived = browser && os ? `${os} · ${browser}` : (os || browser || null);

    return {
        ip_address: req?.ip || req?.socket?.remoteAddress || null,
        user_agent: userAgent ? userAgent.slice(0, 500) : null,
        browser,
        os,
        device_type: parsed?.device?.type || (os ? 'desktop' : null),
        device_name: declared || derived,
        location: null,
    };
};

/** A bearer caller is the app; a cookie caller is the portal. */
const transportOf = (req) => (
    /^Bearer\s+/i.test(req?.get?.('authorization') || '') ? 'app' : 'web'
);

/* ── Issuing ─────────────────────────────────────────────────────────────── */

/**
 * Start a session and mint the pair that belongs to it.
 *
 * The `jti` is generated HERE and pushed into both the refresh token and the
 * row, so the token carries its own primary key. That is what makes revocation
 * a lookup instead of a token-format change.
 */
const issueSession = async ({ client, req, trustDevice = false, transaction = null }) => {
    const jti = randomUUID();
    const meta = describeRequest(req);

    const session = await ClientSession.create({
        website_client_id: client.id,
        jti,
        transport: transportOf(req),
        ...meta,
        last_active_at: new Date(),
        expires_at: new Date(Date.now() + REFRESH_MAX_AGE_MS),
        trusted_until: trustDevice
            ? new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000)
            : null,
    }, { transaction });

    return {
        session,
        accessToken: generateWebsiteClientAccessToken(client, jti),
        refreshToken: generateWebsiteClientRefreshToken(client, jti),
    };
};

/**
 * Rotate: revoke the presented session and open its successor.
 *
 * Single-use, enforced by the UPDATE's own row count inside a transaction —
 * exactly as utils/clientSession.js:117-124 does it. If two requests present the
 * same refresh token, only one of them can win the update, and the loser throws
 * rather than both being handed working tokens.
 */
const rotateSession = async ({ jti, client, req }) => {
    return sequelize.transaction(async (t) => {
        const [revoked] = await ClientSession.update(
            { revoked_at: new Date(), revoked_reason: 'rotated' },
            { where: { jti, revoked_at: null }, transaction: t },
        );
        if (revoked !== 1) {
            throw ApiError.unauthorized('That session has already been used or signed out.');
        }

        const previous = await ClientSession.findOne({ where: { jti }, transaction: t });

        const next = await issueSession({ client, req, transaction: t });
        /*
          Trust follows the device across a rotation. It is a property of the
          machine somebody sat at, not of the fifteen-minute token that happened
          to be current when they last refreshed.
        */
        if (previous?.trusted_until) {
            await next.session.update({ trusted_until: previous.trusted_until }, { transaction: t });
        }
        return next;
    });
};

/* ── Validation ──────────────────────────────────────────────────────────── */

/**
 * The session behind an access token's `sid`, with its client attached.
 *
 * ONE query, deliberately. The auth middleware already reads the client row on
 * every request; production is roughly 374ms per round trip, so fetching the
 * session separately would double the cost of every authenticated call. The
 * include makes it the same trip.
 *
 * Returns null for an unknown, revoked or expired session — the caller decides
 * what that means, because the middleware's fallback for a token with no `sid`
 * is different from a token whose session was explicitly revoked.
 */
const findLiveSession = async (jti) => {
    if (!jti) return null;
    const session = await ClientSession.findOne({
        where: {
            jti,
            revoked_at: null,
            expires_at: { [Op.gt]: new Date() },
        },
        include: [{ model: WebsiteClient, as: 'client' }],
    });
    return session || null;
};

/**
 * Stamp liveness, but not on every request.
 *
 * "Last active" only needs to be roughly right, and writing on each call would
 * add a write to every authenticated request — on a 374ms link, to save a
 * number nobody reads to the minute.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const touchSession = async (session) => {
    if (!session) return;
    const last = new Date(session.last_active_at).getTime();
    if (Date.now() - last < TOUCH_INTERVAL_MS) return;
    await session.update({ last_active_at: new Date() });
};

/* ── Revoking ────────────────────────────────────────────────────────────── */

const revokeByJti = async (jti, reason = 'logout') => {
    if (!jti) return 0;
    const [count] = await ClientSession.update(
        { revoked_at: new Date(), revoked_reason: reason },
        { where: { jti, revoked_at: null } },
    );
    return count;
};

/** Revoke one of the client's OWN sessions. Scoped, so an id cannot reach another account. */
const revokeById = async (clientId, sessionId, reason = 'revoked') => {
    const session = await ClientSession.findOne({
        where: { id: sessionId, website_client_id: clientId },
    });
    if (!session) throw ApiError.notFound('That session was not found.');
    if (session.revoked_at) return session;
    await session.update({ revoked_at: new Date(), revoked_reason: reason });
    return session;
};

/**
 * Everything except the one asking.
 *
 * `exceptJti` is the caller's own session. Signing yourself out as a side effect
 * of "log out my other devices" is the kind of surprise that makes somebody
 * think the button did something worse than it did.
 */
const revokeAllOthers = async (clientId, exceptJti, reason = 'revoked_all') => {
    const [count] = await ClientSession.update(
        { revoked_at: new Date(), revoked_reason: reason },
        {
            where: {
                website_client_id: clientId,
                revoked_at: null,
                ...(exceptJti ? { jti: { [Op.ne]: exceptJti } } : {}),
            },
        },
    );
    return count;
};

/* ── Reading ─────────────────────────────────────────────────────────────── */

/**
 * The client's sessions, newest activity first.
 *
 * Revoked rows are excluded rather than shown greyed out: the screen answers
 * "who is signed in right now", and a list that mixes live and dead sessions is
 * one somebody has to read carefully to feel safe, which defeats the point.
 */
const listSessions = async (clientId, currentJti) => {
    const rows = await ClientSession.findAll({
        where: {
            website_client_id: clientId,
            revoked_at: null,
            expires_at: { [Op.gt]: new Date() },
        },
        order: [['last_active_at', 'DESC']],
        limit: 50,
    });

    return rows.map((row) => presentSession(row, currentJti));
};

/**
 * ⚠ `location` is always null and the API says so rather than omitting it —
 * a field that is absent looks like a bug, one that is explicitly null with a
 * documented reason does not.
 *
 * `is_current` is decided HERE, from the caller's own `sid`, so no screen has to
 * work it out and no two screens can disagree about which row is "this device".
 */
const presentSession = (row, currentJti) => ({
    id: row.id,
    is_current: Boolean(currentJti) && row.jti === currentJti,
    transport: row.transport,
    device_name: row.device_name || (row.transport === 'app' ? 'Mobile app' : 'Unknown device'),
    device_type: row.device_type,
    browser: row.browser,
    os: row.os,
    ip_address: row.ip_address,
    location: row.location,
    last_active_at: row.last_active_at,
    created_at: row.created_at,
    expires_at: row.expires_at,
    is_trusted: Boolean(row.trusted_until) && new Date(row.trusted_until).getTime() > Date.now(),
    trusted_until: row.trusted_until,
});

/**
 * Flag the CURRENT session as trusted, from the 2FA setup screen's checkbox.
 *
 * Separate from the persistent device-trust cookie (utils/jwt.js) that skips
 * the login CHALLENGE across a logout/login — this is display only, for the
 * "Trusted" badge on Active Sessions and Authorized Devices, and it can only
 * mark the session that is asking, never one named by an id in the body.
 */
const trustCurrentSession = async (session) => {
    if (!session) return;
    await session.update({
        trusted_until: new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000),
    });
};

/** Is this device allowed to skip the 2FA code right now? */
const isTrustedDevice = async (clientId, jti) => {
    if (!jti) return false;
    const row = await ClientSession.findOne({
        where: {
            website_client_id: clientId,
            jti,
            revoked_at: null,
            trusted_until: { [Op.gt]: new Date() },
        },
    });
    return Boolean(row);
};

module.exports = {
    describeRequest,
    transportOf,
    issueSession,
    rotateSession,
    findLiveSession,
    touchSession,
    revokeByJti,
    revokeById,
    revokeAllOthers,
    listSessions,
    presentSession,
    trustCurrentSession,
    isTrustedDevice,
    REFRESH_MAX_AGE_MS,
    TRUST_DAYS,
};
