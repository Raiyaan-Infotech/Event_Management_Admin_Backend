const websiteClientService = require('../services/websiteClient.service');
const oauthService = require('../services/websiteClientOAuth.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');
const { generateWebsiteClientAccessToken, generateWebsiteClientRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { WebsiteClient } = require('../models');
const { setWebsiteClientCookies, clearWebsiteClientCookies } = require('../middleware/websiteClientAuth');

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
 * No auth, and no session issued — see the service. Answers 401 for bad
 * credentials, which is what the form shows as an inline error.
 */
const login = asyncHandler(async (req, res) => {
    const vendorId = req.body.vendor_id || req.query.vendor_id || req.companyId || undefined;
    const client = await websiteClientService.login(req.body, vendorId);

    // Issues the portal session. This used to hand back nothing at all —
    // deliberately, because there was no client portal to land in. There is one
    // now, so a successful login has to leave the browser holding something the
    // portal's requests can present.
    //
    // Cookie names and token `type` are website-client specific, NOT the
    // `client_*` pair used by vendor_clients and the older Client Portal:
    // two different tables, and a shared name would let one portal's session
    // authenticate as a row id in the other.
    const accessToken = generateWebsiteClientAccessToken(client);
    const refreshToken = generateWebsiteClientRefreshToken(client);
    setWebsiteClientCookies(res, accessToken, refreshToken);

    logger.logRequest(req, `Website login: ${client.email}`);
    return ApiResponse.success(res, { client }, 'Login successful');
});

/** Ends the portal session. Safe to call when not signed in. */
const logout = asyncHandler(async (req, res) => {
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
        const accessToken = generateWebsiteClientAccessToken(client);
        const refreshToken = generateWebsiteClientRefreshToken(client);
        setWebsiteClientCookies(res, accessToken, refreshToken);

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
const sessionPayload = (client) => ({
    client,
    access_token: generateWebsiteClientAccessToken(client),
    refresh_token: generateWebsiteClientRefreshToken(client),
    token_type: 'Bearer',
    expires_in: 15 * 60,
});

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
    const payload = sessionPayload(client);
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
 * in practice. The old one keeps working until it expires; these are stateless
 * JWTs with no revocation list, so logging out clears the app's copy rather
 * than invalidating it server-side.
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

    const payload = sessionPayload(client);
    setWebsiteClientCookies(res, payload.access_token, payload.refresh_token);
    return ApiResponse.success(res, payload, 'Session refreshed');
});

module.exports = {
    register,
    login,
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
