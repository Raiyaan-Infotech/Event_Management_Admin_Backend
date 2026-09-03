const websiteClientService = require('../services/websiteClient.service');
const oauthService = require('../services/websiteClientOAuth.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');
const {
    generateWebsiteClientAccessToken, generateWebsiteClientRefreshToken, verifyRefreshToken,
    generateWebsiteClient2faChallengeToken, verifyWebsiteClient2faChallengeToken,
    generateDeviceTrustToken, verifyDeviceTrustToken,
} = require('../utils/jwt');
const { WebsiteClient } = require('../models');
const {
    setWebsiteClientCookies, clearWebsiteClientCookies,
    setDeviceTrustCookie, COOKIE_DEVICE_TRUST,
} = require('../middleware/websiteClientAuth');
const sessionService = require('../services/clientSession.service');
const twoFactorService = require('../services/clientTwoFactor.service');

// ── Public: signup from the tenant website ───────────────────────────────────

/**
 * No auth. The tenant is resolved server-side — `x-company-id` / `?vendor_id=`
 * are read through the same optional company context the rest of the public
 * API uses, and fall back to the default vendor.
 */
const register = asyncHandler(async (req, res) => {
    const vendorId = req.body.vendor_id || req.query.vendor_id || req.companyId || undefined;
    const client = await websiteClientService.register(req.body, vendorId, req.companyId ?? null);
    logger.logRequest(req, `Website signup: ${client.email}`);
    return ApiResponse.success(res, { client }, 'Account created successfully', 201);
});

/**
 * No auth, and no session issued until the identity check is COMPLETE.
 * Answers 401 for bad credentials, which is what the form shows as an inline
 * error.
 *
 * ── ⚠ THE PASSWORD CHECK IS NOT THE WHOLE CHECK ─────────────────────────────
 * When 2FA is on for this client, a correct password is only step one. Rather
 * than issue a session and ask for the code afterwards — which would mean a
 * real, cookie-bearing session existed before the second factor was ever
 * checked — this returns a short-lived CHALLENGE token instead, and
 * `verifyLogin2fa` is what actually opens the session. The Flutter app's
 * phone-OTP sign-in never reaches this branch: that is a deliberate product
 * decision (see the 2FA status endpoint's `covers.mobile_app: false`), so a
 * 2FA client can still get into the app without a code.
 *
 * "Trust this device for 30 days" skips the challenge on a browser that
 * already proved it, via a cookie separate from the session — see
 * `generateDeviceTrustToken` for how re-enrolling in 2FA invalidates it.
 */
const login = asyncHandler(async (req, res) => {
    const vendorId = req.body.vendor_id || req.query.vendor_id || req.companyId || undefined;
    const client = await websiteClientService.login(req.body, vendorId);

    if (await twoFactorService.isEnabledFor(client.id)) {
        const trustToken = req.cookies?.[COOKIE_DEVICE_TRUST];
        const trustDecoded = trustToken ? verifyDeviceTrustToken(trustToken) : null;
        const trusted = Boolean(trustDecoded)
            && trustDecoded.id === client.id
            && await twoFactorService.deviceTrustMatches(client.id, trustDecoded.tfa);

        if (!trusted) {
            const challengeToken = generateWebsiteClient2faChallengeToken(client);
            logger.logRequest(req, `Website login: 2FA challenge issued for ${client.email}`);
            return ApiResponse.success(res, {
                requires_2fa: true,
                challenge_token: challengeToken,
                expires_in: 10 * 60,
            }, 'Enter your two-factor code to finish signing in');
        }
    }

    // Issues the portal session. This used to hand back nothing at all —
    // deliberately, because there was no client portal to land in. There is one
    // now, so a successful login has to leave the browser holding something the
    // portal's requests can present.
    //
    // Cookie names and token `type` are website-client specific, NOT the
    // `client_*` pair used by vendor_clients and the older Client Portal:
    // two different tables, and a shared name would let one portal's session
    // authenticate as a row id in the other.
    // Recorded as a session row, which is what makes it appear on Active
    // Sessions and what makes revoking it possible at all.
    const { accessToken, refreshToken } = await sessionService.issueSession({ client, req });
    setWebsiteClientCookies(res, accessToken, refreshToken);

    logger.logRequest(req, `Website login: ${client.email}`);
    return ApiResponse.success(res, { client }, 'Login successful');
});

/**
 * Step 2 of a 2FA-gated login: a challenge token plus a code, exchanged for a
 * real session.
 *
 * Needs no auth middleware of its own — the challenge token IS the proof the
 * password was already correct, a minute or two ago. It cannot be reused for
 * anything else: `isWebsiteClientAuthenticated` only accepts
 * `type: 'website_client'`, and this token's type is
 * `website_client_2fa_challenge`.
 */
const verifyLogin2fa = asyncHandler(async (req, res) => {
    const decoded = verifyWebsiteClient2faChallengeToken(req.body?.challenge_token);
    if (!decoded) {
        return ApiResponse.error(res, 'That sign-in attempt has expired. Please sign in again.', 401);
    }

    const client = await WebsiteClient.findByPk(decoded.id);
    if (!client) return ApiResponse.error(res, 'Your account no longer exists.', 401);
    if (Number(client.is_active) !== 1) {
        return ApiResponse.error(res, 'Your account is not active. Please contact us.', 403);
    }

    const verified = await twoFactorService.verifyForLogin(client.id, req.body?.code);
    if (!verified) {
        return ApiResponse.error(res, 'That code is not right. Check your authenticator app and try again.', 401);
    }

    const { accessToken, refreshToken } = await sessionService.issueSession({ client, req });
    setWebsiteClientCookies(res, accessToken, refreshToken);

    if (req.body?.trust_device) {
        const confirmedAt = await twoFactorService.confirmedAtFor(client.id);
        setDeviceTrustCookie(res, generateDeviceTrustToken(client, confirmedAt));
    }

    logger.logRequest(req, `Website login: 2FA verified for ${client.email}`);
    return ApiResponse.success(res, { client }, 'Login successful');
});

/**
 * Ends the portal session. Safe to call when not signed in.
 *
 * The session row is revoked, not just the cookies cleared. Clearing a cookie
 * asks the browser to forget a token that stays valid for another seven days;
 * on a shared computer that is the difference between signing out and appearing
 * to sign out.
 */
const logout = asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.website_client_refresh_token || req.body?.refresh_token;
    if (refreshToken) {
        const decoded = verifyRefreshToken(refreshToken);
        if (decoded?.type === 'website_client' && decoded.jti) {
            await sessionService.revokeByJti(decoded.jti, 'logout');
        }
    }
    clearWebsiteClientCookies(res);
    return ApiResponse.success(res, null, 'Logged out successfully');
});

// ── Public: social sign-in ───────────────────────────────────────────────────

/**
 * Sends the browser to the provider's consent screen.
 *
 * A top-level 302, not JSON: the browser has to LEAVE for accounts.google.com,
 * which an XHR cannot do. So the frontend navigates here rather than fetching.
 */
const oauthStart = asyncHandler(async (req, res) => {
    const { provider } = req.params;
    const returnTo = req.query.return_to || req.get('referer');
    const vendorId = req.query.vendor_id || req.companyId || undefined;

    const url = await oauthService.buildAuthorizeUrl({
        provider,
        returnTo,
        vendorId,
        companyId: req.companyId ?? null,
    });

    logger.logRequest(req, `OAuth start: ${provider}`);
    return res.redirect(url);
});

/**
 * Where the provider sends the browser back.
 *
 * Every exit from here is a redirect to the site the visitor started on, with
 * the outcome in the query string — never a JSON body, because the browser is
 * doing a top-level navigation and would otherwise be left staring at raw JSON
 * on the API's domain.
 *
 * The one exception is a `state` we cannot verify. That is the only case where
 * we do not know where "back" is, and guessing from `referer` is exactly the
 * open redirect the signing exists to prevent — so it answers 400 in place.
 */
const oauthCallback = asyncHandler(async (req, res) => {
    const { provider } = req.params;
    const { code, state } = req.query;

    const decoded = oauthService.verifyState(state);
    if (!decoded || decoded.p !== String(provider).toLowerCase()) {
        logger.logRequest(req, `OAuth callback rejected: bad state (${provider})`);
        return res.status(400).send('Sign-in link has expired or is invalid. Please try again.');
    }

    // Re-check the return URL even though it came out of a signed token. The
    // signature only proves WE minted it, and start mints whatever it is asked
    // for — the allowlist is the actual guard, so it runs on both legs.
    if (!(await oauthService.isAllowedReturnTo(decoded.r))) {
        logger.logRequest(req, `OAuth callback rejected: return_to not allowed`);
        return res.status(400).send('Sign-in return address is not an allowed site.');
    }

    const back = (params) => {
        const url = new URL(decoded.r);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        return res.redirect(url.toString());
    };

    // The visitor pressed Cancel on the consent screen. Not an error worth a
    // stack trace — send them back quietly.
    if (req.query.error || !code) {
        return back({ auth: 'cancelled' });
    }

    try {
        const profile = await oauthService.exchangeCodeForProfile(provider, code);
        const { client, created } = await oauthService.findOrCreateFromProfile({
            providerName: String(provider).toLowerCase(),
            profile,
            vendorId: decoded.v,
            companyId: decoded.c ?? null,
        });

        logger.logRequest(req, `OAuth ${created ? 'signup' : 'login'}: ${client.email} via ${provider}`);

        /**
         * ── ISSUE THE SESSION. THIS WAS MISSING ENTIRELY ─────────────────────
         * The password login has always minted these cookies; this branch never
         * did. It logged "OAuth login: <email>", redirected back with
         * `auth=success`, and left the browser holding NOTHING — so the site
         * said "Login successful", the portal then called /client/me, and got a
         * 401 in under a millisecond because no cookie was ever sent.
         *
         * Social sign-in has therefore never produced a working session. It
         * looked fine from the website, because the website only reads the
         * query string; the failure only showed up one app later.
         *
         * Set BEFORE the redirect: Set-Cookie on a 302 is stored by the browser
         * before it follows the Location header, which is exactly what is
         * wanted here.
         *
         * Issued even when the mobile step is still pending. The provider has
         * already proven who this is — collecting a phone number is profile
         * completion, not authentication — and the front end keeps the visitor
         * on the page for that step regardless.
         */
        const social = await sessionService.issueSession({ client, req });
        setWebsiteClientCookies(res, social.accessToken, social.refreshToken);

        // A provider never tells us a phone number, so the mobile step happens
        // after the round trip. Only asked for when the account has none —
        // re-prompting someone who already verified would be noise.
        const needsMobile = !client.mobile;

        return back({
            auth: 'success',
            mode: created ? 'signup' : 'login',
            provider: String(provider).toLowerCase(),
            name: client.name || '',
            ...(needsMobile
                ? {
                      needs_mobile: '1',
                      // Scoped to this client and this purpose, and short-lived.
                      // Kept even though a session cookie is now issued above:
                      // the mobile endpoint accepts this token, and changing
                      // both sides at once would break any tab mid-flow.
                      link_token: oauthService.signMobileToken(client.id),
                  }
                : {}),
        });
    } catch (err) {
        // Provider outages and refusals both land here.
        //
        // An axios failure's own `message` is only "Request failed with status
        // code 400" - the provider's actual explanation ("Error validating
        // client secret", "redirect_uri mismatch") sits in the response body,
        // and reporting the former told nobody anything.
        const providerError =
            err?.response?.data?.error?.message ||      // Facebook / Graph API
            err?.response?.data?.error_description ||   // Google / OIDC
            (typeof err?.response?.data?.error === 'string' ? err.response.data.error : null);

        const message = err?.isOperational
            ? err.message
            : providerError || 'Sign-in failed. Please try again.';

        logger.error(
            `OAuth ${provider} failed: ${err?.message}` +
                (err?.response?.data ? ` | provider said: ${JSON.stringify(err.response.data)}` : '') +
                (err?.stack ? `\n${err.stack}` : '')
        );
        return back({ auth: 'error', message });
    }
});

/**
 * Issues a code for the mobile step. See the service: the code is real, the
 * DELIVERY is not — there is no SMS provider in this backend yet.
 */
const sendMobileOtp = asyncHandler(async (req, res) => {
    const result = await oauthService.sendMobileOtp({
        token: req.body.token,
        dialCode: req.body.dial_code,
        mobile: req.body.mobile,
    });
    return ApiResponse.success(res, result, 'Verification code sent.');
});

/** Checks the code and writes the number onto the account. */
const verifyMobileOtp = asyncHandler(async (req, res) => {
    const client = await oauthService.verifyMobileOtp({
        token: req.body.token,
        dialCode: req.body.dial_code,
        mobile: req.body.mobile,
        otp: req.body.otp,
    });
    logger.logRequest(req, `Mobile verified for website client ${client.id}`);
    return ApiResponse.success(res, { client }, 'Mobile number verified.');
});

/** Lets the frontend hide a provider button that this server cannot serve. */
const oauthProviders = asyncHandler(async (req, res) =>
    ApiResponse.success(res, { providers: oauthService.listConfiguredProviders() })
);

// ── Admin ────────────────────────────────────────────────────────────────────

const getAll = asyncHandler(async (req, res) => {
    const result = await websiteClientService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${result.data.length} website clients`);
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getStats = asyncHandler(async (req, res) => {
    const stats = await websiteClientService.getStats(req.companyId);
    return ApiResponse.success(res, { stats });
});

const getById = asyncHandler(async (req, res) => {
    const client = await websiteClientService.getById(req.params.id, req.companyId);
    logger.logRequest(req, `Fetched website client ${req.params.id}`);
    return ApiResponse.success(res, { client });
});

const create = asyncHandler(async (req, res) => {
    const client = await websiteClientService.create(req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Created website client: ${client.email}`);
    return ApiResponse.success(res, { client }, 'Client created successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const client = await websiteClientService.update(
        req.params.id,
        req.body,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated website client ${req.params.id}`);
    return ApiResponse.success(res, { client }, 'Client updated successfully');
});

const updateStatus = asyncHandler(async (req, res) => {
    const client = await websiteClientService.updateStatus(
        req.params.id,
        req.body.is_active,
        req.user.id,
        req.companyId
    );
    logger.logRequest(req, `Updated status for website client ${req.params.id}`);
    return ApiResponse.success(res, { client }, 'Client status updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await websiteClientService.deleteById(req.params.id, req.user.id, req.companyId);
    logger.logRequest(req, `Deleted website client ${req.params.id}`);
    return ApiResponse.success(res, null, 'Client deleted successfully');
});


// ── Public: mobile OTP login (the mobile app) ────────────────────────────────

/**
 * The session payload for a NATIVE client.
 *
 * Tokens in the BODY, not in Set-Cookie. A Flutter app is not a browser: it has
 * no cookie jar, and a Set-Cookie header on a native HTTP client is simply
 * dropped. The web portal keeps its cookies — this is an additional transport,
 * not a replacement.
 *
 * `expires_in` is stated so the app can refresh ahead of expiry instead of
 * hardcoding a number that only this backend knows.
 */
const sessionPayload = async (client, req) => {
    const { accessToken, refreshToken } = await sessionService.issueSession({ client, req });
    return {
        client,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 15 * 60,
    };
};

/** Step 1 — send a code to a registered mobile number. */
const requestLoginOtp = asyncHandler(async (req, res) => {
    const vendorId = req.body.vendor_id || req.query.vendor_id || req.companyId || undefined;
    const result = await websiteClientService.requestLoginOtp(req.body, vendorId);
    logger.logRequest(req, 'Mobile OTP login requested');
    return ApiResponse.success(res, result, 'Verification code sent.');
});

/** Step 2 — check the code and hand back the session. */
const verifyLoginOtp = asyncHandler(async (req, res) => {
    const vendorId = req.body.vendor_id || req.query.vendor_id || req.companyId || undefined;
    const client = await websiteClientService.verifyLoginOtp(req.body, vendorId);

    // Cookies are set as well, so the SAME endpoint works if the web portal ever
    // wants OTP sign-in. Harmless to an app, which ignores them.
    const payload = await sessionPayload(client, req);
    setWebsiteClientCookies(res, payload.access_token, payload.refresh_token);

    logger.logRequest(req, `Mobile OTP login: client ${client.id}`);
    return ApiResponse.success(res, payload, 'Login successful');
});

/**
 * Trades a refresh token for a fresh pair.
 *
 * Exists for bearer callers specifically. A cookie caller is refreshed inside
 * `isWebsiteClientAuthenticated`, which can rotate the cookie mid-request; an
 * app has nowhere to receive that, so it asks here and stores what comes back.
 *
 * The client row is re-read and re-checked rather than trusted from the token:
 * this is the one moment a deactivated or deleted account can be caught before
 * being handed another 15 minutes of access.
 *
 * A NEW refresh token is returned each time, so an app that stays in use never
 * reaches the 7-day expiry — which is what "signed in until you log out" means
 * in practice.
 *
 * ── ROTATION IS SINGLE-USE, AND REVOCATION IS REAL ──────────────────────────
 * This used to end: "these are stateless JWTs with no revocation list, so
 * logging out clears the app's copy rather than invalidating it server-side."
 * That is no longer true. The token's `jti` names a `client_sessions` row, and
 * rotation revokes that row as it opens the next one — inside a transaction, so
 * a token presented twice can only win once. A revoked session cannot be
 * refreshed, which is what makes "Log Out" on the Active Sessions screen bite
 * on a device that is not in the room.
 */
const refreshSession = asyncHandler(async (req, res) => {
    const token = req.body.refresh_token || req.cookies?.website_client_refresh_token;
    if (!token) return ApiResponse.error(res, 'A refresh token is required.', 401);

    const decoded = verifyRefreshToken(token);
    if (!decoded || decoded.type !== 'website_client') {
        return ApiResponse.error(res, 'Your session has expired. Please sign in again.', 401);
    }

    const client = await WebsiteClient.findByPk(decoded.id);
    if (!client) {
        return ApiResponse.error(res, 'Your account no longer exists.', 401);
    }
    if (Number(client.is_active) !== 1) {
        return ApiResponse.error(res, 'Your account is not active. Please contact us.', 403);
    }

    /*
      A token from before sessions existed has no `jti` row to rotate. It is
      exchanged for a session-backed pair rather than refused — the alternative
      signs out every app install on the day this deploys.
    */
    const live = decoded.jti ? await sessionService.findLiveSession(decoded.jti) : null;
    if (decoded.jti && !live) {
        return ApiResponse.error(res, 'This session was signed out. Please sign in again.', 401);
    }

    let issued;
    try {
        issued = live
            ? await sessionService.rotateSession({ jti: decoded.jti, client, req })
            : await sessionService.issueSession({ client, req });
    } catch {
        // rotateSession throws when the row was already spent — a replayed
        // refresh token, or two app requests racing. Neither should be handed a
        // working session.
        return ApiResponse.error(res, 'This session was signed out. Please sign in again.', 401);
    }

    const payload = {
        client,
        access_token: issued.accessToken,
        refresh_token: issued.refreshToken,
        token_type: 'Bearer',
        expires_in: 15 * 60,
    };
    setWebsiteClientCookies(res, payload.access_token, payload.refresh_token);
    return ApiResponse.success(res, payload, 'Session refreshed');
});

module.exports = {
    register,
    login,
    verifyLogin2fa,
    logout,
    requestLoginOtp,
    verifyLoginOtp,
    refreshSession,
    oauthStart,
    oauthCallback,
    oauthProviders,
    sendMobileOtp,
    verifyMobileOtp,
    getAll,
    getStats,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
};
