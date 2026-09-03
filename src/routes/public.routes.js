const express = require('express');
const router = express.Router();
const {
    getPublicVendorWebsite,
    registerPublicVendorClient,
    loginPublicVendorClient,
    subscribePublicVendorNewsletter,
    submitPublicVendorContact,
} = require('../controllers/publicWebsite.controller');
const {
    resolvePublicSite,
    getPublicSiteBundle,
} = require('../controllers/companyPublicSite.controller');
const websiteClientController = require('../controllers/websiteClient.controller');
const { authLimiter, codeLimiter, refreshLimiter } = require('../middleware/rateLimit');

// ── Company website builder: host-addressed public read model ───────────────
// Consumed by the standalone public site app, which knows the visitor's Host
// but has no company id to send.
router.get('/site/resolve', resolvePublicSite);
router.get('/site/bundle', getPublicSiteBundle);

router.get('/vendors/:slug/website-data', getPublicVendorWebsite);
router.get('/website/:slug', getPublicVendorWebsite);
router.post('/vendors/:slug/register-client', registerPublicVendorClient);
router.post('/vendors/:slug/login-client', loginPublicVendorClient);
router.post('/vendors/:slug/newsletter-subscribe', subscribePublicVendorNewsletter);
router.post('/vendors/:slug/contact', submitPublicVendorContact);

// ── Website signup ──────────────────────────────────────────────────────────
// The public site's signup form. Creates a `website_clients` row, which the
// admin panel's Clients module lists. No session is issued — these accounts
// have no portal to log into yet.
router.post('/website-clients/register', authLimiter, websiteClientController.register);
// Verifies credentials, then opens a session row — see the controller. Rate
// limited because this is the endpoint somebody points a password list at, and
// until now nothing in this codebase was throttled at all.
router.post('/website-clients/login', authLimiter, websiteClientController.login);
// Step 2 when `login` answers `requires_2fa: true`. A six-digit code, so it
// gets the tight limiter — same reasoning as the OTP verify route below.
router.post('/website-clients/login/2fa/verify', codeLimiter, websiteClientController.verifyLogin2fa);
router.post('/website-clients/logout', websiteClientController.logout);

// ── Mobile app sign-in: OTP to the number already on the account ────────────
// Distinct from /website-clients/mobile/* below, which ATTACHES a number to an
// account already authenticated by a social sign-in. These AUTHENTICATE.
//
// ⚠ `verify` takes a SIX DIGIT code, so it gets the tight limiter: without one,
// the whole keyspace is reachable in minutes. (Note that with OTP_ACCEPT_ANY
// set, it accepts anything at all — that is an env setting, not something a
// rate limit can compensate for.)
router.post('/website-clients/login/otp/request', authLimiter, websiteClientController.requestLoginOtp);
router.post('/website-clients/login/otp/verify', codeLimiter, websiteClientController.verifyLoginOtp);
// Bearer callers refresh explicitly; cookie callers are refreshed in the middleware.
router.post('/website-clients/token/refresh', refreshLimiter, websiteClientController.refreshSession);

// ── Social sign-in ──────────────────────────────────────────────────────────
// `start` and `callback` are top-level browser navigations that answer with a
// 302, not JSON — the browser has to physically leave for the provider and come
// back. Only ONE callback URL is registered per provider (this server's own);
// the tenant site to return to travels inside the signed `state`, because
// tenant domains are open-ended and cannot all be registered up front.
router.get('/website-clients/oauth/providers', websiteClientController.oauthProviders);
router.get('/website-clients/oauth/:provider/start', websiteClientController.oauthStart);
router.get('/website-clients/oauth/:provider/callback', websiteClientController.oauthCallback);

// Mobile step that follows a social sign-in. Authorised by the short-lived
// `link_token` the callback handed over, not by a session — these accounts do
// not have one.
router.post('/website-clients/mobile/send-otp', authLimiter, websiteClientController.sendMobileOtp);
router.post('/website-clients/mobile/verify', codeLimiter, websiteClientController.verifyMobileOtp);

module.exports = router;
