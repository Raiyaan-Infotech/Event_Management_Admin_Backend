const express = require('express');
const router = express.Router();
const {
    getPublicVendorWebsite,
    registerPublicVendorClient,
    loginPublicVendorClient,
    subscribePublicVendorNewsletter,
} = require('../controllers/publicWebsite.controller');

router.get('/vendors/:slug/website-data', getPublicVendorWebsite);
router.post('/vendors/:slug/register-client', registerPublicVendorClient);
router.post('/vendors/:slug/login-client', loginPublicVendorClient);
router.post('/vendors/:slug/newsletter-subscribe', subscribePublicVendorNewsletter);

module.exports = router;
