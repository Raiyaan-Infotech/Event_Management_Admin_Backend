const express = require('express');
const router = express.Router();
const {
    getPublicVendorWebsite,
    registerPublicVendorClient,
    loginPublicVendorClient,
    subscribePublicVendorNewsletter,
    submitPublicVendorContact,
} = require('../controllers/publicWebsite.controller');

router.get('/vendors/:slug/website-data', getPublicVendorWebsite);
router.get('/website/:slug', getPublicVendorWebsite);
router.post('/vendors/:slug/register-client', registerPublicVendorClient);
router.post('/vendors/:slug/login-client', loginPublicVendorClient);
router.post('/vendors/:slug/newsletter-subscribe', subscribePublicVendorNewsletter);
router.post('/vendors/:slug/contact', submitPublicVendorContact);

module.exports = router;
