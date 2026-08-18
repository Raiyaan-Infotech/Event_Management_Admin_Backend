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
router.post('/website-clients/register', websiteClientController.register);
// Verifies credentials only — no token, no cookie. There is no client portal to
// sign into yet, so the screen just confirms the login was valid.
router.post('/website-clients/login', websiteClientController.login);

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
router.post('/website-clients/mobile/send-otp', websiteClientController.sendMobileOtp);
router.post('/website-clients/mobile/verify', websiteClientController.verifyMobileOtp);

module.exports = router;
