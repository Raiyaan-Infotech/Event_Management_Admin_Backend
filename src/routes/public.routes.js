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

module.exports = router;
