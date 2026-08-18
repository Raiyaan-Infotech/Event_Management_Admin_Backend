/**
 * Google / Facebook sign-in for `website_clients`.
 *
 * ── Why the authorization-code flow, server side ────────────────────────────
 * The client secret never reaches the browser. The browser is only ever sent to
 * the provider and back; the code-for-token exchange and the profile read both
 * happen from this process, over TLS, straight to the provider.
 *
 * ── Why ONE fixed callback URL ──────────────────────────────────────────────
 * Google and Facebook only redirect to URIs registered in their console. Tenant
 * sites live on arbitrary subdomains and custom domains (§120), so registering
 * each one is impossible. Instead every provider redirects back to THIS server,
 * and the tenant URL the visitor came from rides along inside `state`. One URI
 * per provider is registered, forever, no matter how many tenants exist.
 *
 * ── Why `state` is signed ───────────────────────────────────────────────────
 * `state` carries the URL we will redirect the browser to at the end. If that
 * were attacker-controlled this endpoint would be an open redirect wearing the
 * backend's domain — a ready-made phishing hop. So it is a short-lived JWT
 * signed with ACCESS_TOKEN_SECRET, AND the URL inside is re-checked against the
 * allowlist when it comes back. Signing alone is not enough: it only proves we
 * minted it, and we mint whatever the start request asks for.
 */
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sequelize, Sequelize, WebsiteClient, Vendor } = require('../models');
const { QueryTypes } = Sequelize;
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

const DEFAULT_VENDOR_ID = Number(process.env.WEBSITE_CLIENT_DEFAULT_VENDOR_ID || 1);

/** State is only in flight for the length of a consent screen. */
const STATE_TTL_SECONDS = 600;

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

// ── Provider definitions ─────────────────────────────────────────────────────

/**
 * Google's profile is read from the OIDC userinfo endpoint rather than by
 * decoding `id_token`. Same data, and it sidesteps the question of verifying a
 * JWT signature against Google's rotating JWKS — we already trust this response
 * because we fetched it ourselves over TLS with our own client secret.
 */
const PROVIDERS = {
    google: {
        label: 'Google',
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: 'openid email profile',
        clientId: () => process.env.GOOGLE_CLIENT_ID,
        clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
        // `prompt=select_account` so a shared machine does not silently reuse
        // whoever signed in last — the account chooser in the mockup.
        extraAuthParams: { access_type: 'online', prompt: 'select_account' },
        normalizeProfile: (data) => ({
            provider_id: data.sub,
            name: data.name || data.given_name || '',
            email: normalizeEmail(data.email),
            // Google states explicitly whether it has verified the address.
            email_verified: data.email_verified === true || data.email_verified === 'true',
            avatar_url: data.picture || null,
        }),
    },

    facebook: {
        label: 'Facebook',
        authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
        tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
        userInfoUrl: 'https://graph.facebook.com/v21.0/me',
        scope: 'email,public_profile',
        clientId: () => process.env.FACEBOOK_APP_ID,
        clientSecret: () => process.env.FACEBOOK_APP_SECRET,
        extraAuthParams: {},
        userInfoParams: { fields: 'id,name,email,picture.type(large)' },
        normalizeProfile: (data) => ({
            provider_id: data.id,
            name: data.name || '',
            // Facebook may hand back NO email: an account registered by phone,
            // or the user declining the email permission on the consent screen.
            // That case is handled by the caller, not papered over here.
            email: normalizeEmail(data.email),
            // Facebook does not expose a per-address verification flag. An
            // account's email is confirmed at registration, so it is treated as
            // verified — the same assumption every Facebook Login integration
            // makes, and the reason linking is scoped per vendor.
            email_verified: Boolean(data.email),
            avatar_url: data.picture?.data?.url || null,
        }),
    },
};

const getProvider = (name) => {
    const provider = PROVIDERS[String(name || '').toLowerCase()];
    if (!provider) throw ApiError.badRequest('Unknown sign-in provider.');
    return provider;
};

/** Configured = both halves present. A half-configured provider is not offered. */
const isProviderConfigured = (name) => {
    const provider = PROVIDERS[String(name || '').toLowerCase()];
    return Boolean(provider && provider.clientId() && provider.clientSecret());
};

const listConfiguredProviders = () =>
    Object.keys(PROVIDERS).filter(isProviderConfigured);

// ── Callback URL ─────────────────────────────────────────────────────────────

/**
 * Must match what is registered in the provider console EXACTLY — scheme, host,
 * port, path, trailing slash. A mismatch is the single most common cause of
 * `redirect_uri_mismatch`, and the provider reports it before our code runs.
 */
const callbackUrl = (providerName) => {
    const base = String(process.env.OAUTH_CALLBACK_BASE_URL || '').replace(/\/$/, '');
    if (!base) {
        throw ApiError.badRequest(
            'OAUTH_CALLBACK_BASE_URL is not set, so the sign-in redirect cannot be built.'
        );
    }
    return `${base}/api/v1/public/website-clients/oauth/${providerName}/callback`;
};

// ── Return-URL allowlist ─────────────────────────────────────────────────────

const normalizeHost = (host) =>
    String(host || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');

const allowedOrigins = () =>
    String(process.env.FRONTEND_URL || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

const rootDomains = () =>
    String(process.env.PUBLIC_SITE_ROOT_DOMAINS || '')
        .split(',')
        .map((d) => normalizeHost(d))
        .filter(Boolean);

/**
 * Decides whether we are willing to send a browser to `rawUrl` at the end of a
 * sign-in. Three ways to qualify, cheapest first:
 *
 *   1. the exact origin is in FRONTEND_URL (the admin panel, local dev ports)
 *   2. the host sits under a configured public-site root domain
 *   3. the host resolves to a real tenant in `company_websites`
 *
 * Anything else is refused. This is the open-redirect guard, so it fails
 * closed: any parse error, any unknown host, and the answer is no.
 */
const isAllowedReturnTo = async (rawUrl) => {
    let url;
    try {
        url = new URL(String(rawUrl));
    } catch {
        return false;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    if (allowedOrigins().includes(url.origin)) return true;

    const host = normalizeHost(url.hostname);
    if (!host) return false;

    if (rootDomains().some((root) => host === root || host.endsWith(`.${root}`))) return true;

    // Last resort — one indexed lookup against the tenant table.
    try {
        const rows = await sequelize.query(
            `SELECT id FROM company_websites
             WHERE slug = :host OR custom_domain = :host
                OR custom_domain = :withWww
             LIMIT 1`,
            { replacements: { host, withWww: `www.${host}` }, type: QueryTypes.SELECT }
        );
        return rows.length > 0;
    } catch (err) {
        logger.error?.(`OAuth return-to lookup failed: ${err.message}`);
        return false;
    }
};

// ── State ────────────────────────────────────────────────────────────────────

const stateSecret = () => {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) throw ApiError.badRequest('ACCESS_TOKEN_SECRET is not set.');
    return secret;
};

const signState = (payload) =>
    jwt.sign({ ...payload, nonce: crypto.randomBytes(8).toString('hex') }, stateSecret(), {
        expiresIn: STATE_TTL_SECONDS,
    });

const verifyState = (state) => {
    try {
        return jwt.verify(String(state || ''), stateSecret());
    } catch {
        // Covers a tampered state, a foreign state, and simply taking too long
        // on the consent screen. All three mean the same thing to the visitor.
        return null;
    }
};

// ── Step 1: where to send the browser ────────────────────────────────────────

const buildAuthorizeUrl = async ({ provider: providerName, returnTo, vendorId, companyId }) => {
    const provider = getProvider(providerName);

    if (!isProviderConfigured(providerName)) {
        throw ApiError.badRequest(`${provider.label} sign-in is not configured on this server.`);
    }

    if (!(await isAllowedReturnTo(returnTo))) {
        throw ApiError.badRequest('That return address is not an allowed site.');
    }

    const state = signState({
        p: providerName,
        r: returnTo,
        v: Number(vendorId) || DEFAULT_VENDOR_ID,
        c: companyId ?? null,
    });

    const params = new URLSearchParams({
        client_id: provider.clientId(),
        redirect_uri: callbackUrl(providerName),
        response_type: 'code',
        scope: provider.scope,
        state,
        ...provider.extraAuthParams,
    });

    return `${provider.authorizeUrl}?${params.toString()}`;
};

// ── Step 2: code -> tokens -> profile ────────────────────────────────────────

const exchangeCodeForProfile = async (providerName, code) => {
    const provider = getProvider(providerName);

    const tokenResponse = await axios.post(
        provider.tokenUrl,
        new URLSearchParams({
            client_id: provider.clientId(),
            client_secret: provider.clientSecret(),
            code,
            redirect_uri: callbackUrl(providerName),
            grant_type: 'authorization_code',
        }).toString(),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            timeout: 15000,
        }
    );

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) throw ApiError.badRequest('The sign-in provider did not return an access token.');

    const userInfo = await axios.get(provider.userInfoUrl, {
        params: { ...(provider.userInfoParams || {}) },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
    });

    const profile = provider.normalizeProfile(userInfo.data || {});
    if (!profile.provider_id) {
        throw ApiError.badRequest('The sign-in provider did not identify the account.');
    }
    return profile;
};

// ── Step 3: find or create the client ────────────────────────────────────────

/**
 * Resolution order, and why:
 *
 *   1. (vendor, source, provider_id) — the account we already linked. Survives
 *      the person changing the email on their Google account.
 *   2. (vendor, email) — an existing account, linked on first social sign-in.
 *      ONLY when the provider says the address is verified. Without that check
 *      anyone could register `you@example.com` at a provider that never checks
 *      it and take over your account here.
 *   3. otherwise create a new row.
 *
 * Scoped by vendor throughout: two tenants may legitimately have the same
 * person as separate clients, exactly as the email-uniqueness rule already assumes.
 */
const findOrCreateFromProfile = async ({ providerName, profile, vendorId, companyId }) => {
    const resolvedVendorId = Number(vendorId) || DEFAULT_VENDOR_ID;

    let resolvedCompanyId = companyId ?? null;
    if (resolvedCompanyId == null) {
        const vendor = await Vendor.findByPk(resolvedVendorId, { attributes: ['id', 'company_id'] });
        resolvedCompanyId = vendor?.company_id ?? null;
    }

    // 1 — already linked.
    let client = await WebsiteClient.findOne({
        where: {
            vendor_id: resolvedVendorId,
            source: providerName,
            provider_id: String(profile.provider_id),
        },
    });

    let created = false;

    // 2 — same verified email, different sign-in method.
    if (!client && profile.email && profile.email_verified) {
        client = await WebsiteClient.findOne({
            where: { vendor_id: resolvedVendorId, email: profile.email },
        });
        if (client) {
            // Link, but do NOT rewrite `source`: that column records how the
            // row was first created, and the admin list filters on it.
            await client.update({
                provider_id: String(profile.provider_id),
                avatar_url: client.avatar_url || profile.avatar_url,
                email_verified: 1,
            });
        }
    }

    // 3 — new client.
    if (!client) {
        if (!profile.email) {
            // Facebook can withhold it. Better a clear message than a row with
            // a fabricated address that can never sign in with a password.
            throw ApiError.badRequest(
                'Your provider did not share an email address, so an account could not be created.'
            );
        }

        // An unverified provider email may not claim an existing local account,
        // and there is a UNIQUE-ish expectation on (vendor, email) enforced in
        // the service — so a collision here is a real conflict, not a link.
        const clash = await WebsiteClient.findOne({
            where: { vendor_id: resolvedVendorId, email: profile.email },
            attributes: ['id'],
        });
        if (clash) {
            throw ApiError.badRequest(
                'An account with this email already exists. Please sign in with your password.'
            );
        }

        client = await WebsiteClient.create({
            vendor_id: resolvedVendorId,
            company_id: resolvedCompanyId,
            name: profile.name || profile.email.split('@')[0],
            email: profile.email,
            // No password at all. The column is nullable, and the login service
            // rejects a row without one, so a social account cannot be signed
            // into with a guessed password.
            password: null,
            source: providerName,
            provider_id: String(profile.provider_id),
            avatar_url: profile.avatar_url,
            email_verified: profile.email_verified ? 1 : 0,
            mobile_verified: 0,
            is_active: 1,
            created_by: null,
        });
        created = true;
    }

    if (client.is_active !== 1) {
        throw ApiError.forbidden('Your account is not active. Please contact us.');
    }

    // Re-read through the default scope, then stamp — the same reasoning as the
    // password login: the instance that is saved must not be carrying a hash.
    const safeClient = await WebsiteClient.findByPk(client.id);
    await safeClient.update({ last_login_at: new Date() });

    return { client: safeClient, created };
};

module.exports = {
    PROVIDERS,
    getProvider,
    isProviderConfigured,
    listConfiguredProviders,
    callbackUrl,
    isAllowedReturnTo,
    signState,
    verifyState,
    buildAuthorizeUrl,
    exchangeCodeForProfile,
    findOrCreateFromProfile,
};
