const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/clientPortal.controller');
const eventController = require('../controllers/clientEvent.controller');
const guestController = require('../controllers/clientGuest.controller');
const billingController = require('../controllers/clientBilling.controller');
const { isWebsiteClientAuthenticated } = require('../middleware/websiteClientAuth');

/**
 * Client portal API — everything here requires a signed-in website client.
 *
 * Mounted at /api/v1/client. Deliberately separate from the admin routes: a
 * client must never reach /event-categories directly, because that endpoint is
 * the whole catalogue rather than what their plan allows.
 */
router.use(isWebsiteClientAuthenticated);

router.get('/me', controller.me);
// Self-service account management. No id parameter anywhere: each acts on the
// session's own client, so none of them can be aimed at another account.
router.put('/me', controller.updateMe);
router.put('/me/password', controller.changeMyPassword);
router.delete('/me', controller.deleteMyAccount);

/**
 * Avatar upload, client-scoped.
 *
 * `/media/upload` cannot serve this: it sits behind the admin JWT,
 * `hasPermission('media.upload')` and the approval middleware, so a website
 * client gets 401. Same reason `/client/media/proxy` exists.
 *
 * IMAGES ONLY and 4MB, both stricter than the admin uploader's 10MB and its
 * list that includes PDF, video and audio. A profile photo has no reason to be
 * any of those, and the narrower the filter the less there is to get wrong.
 *
 * SVG is excluded deliberately, unlike the admin list: an SVG is a document
 * that can carry script, and this one is rendered back into other people's
 * pages. The raster formats cannot do that.
 */
const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowed.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Please choose a JPG, PNG, WEBP or GIF image.'), false);
    },
});

router.put(
    '/me/avatar',
    (req, res, next) => {
        // Multer's own errors are surfaced as a readable 400 rather than
        // reaching the generic handler as a 500 — "File too large" is something
        // the person can act on.
        avatarUpload.single('file')(req, res, (err) => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.code === 'LIMIT_FILE_SIZE'
                        ? 'That image is larger than 4MB.'
                        : err.message || 'That image could not be uploaded.',
                });
            }
            next();
        });
    },
    controller.updateMyAvatar,
);
router.delete('/me/avatar', controller.removeMyAvatar);
router.get('/event-options', controller.eventOptions);
router.put('/favourite-templates', controller.setFavouriteTemplates);

// Inlines one of our own uploaded files as a data URI, so the invitation
// download can rasterise a card whose frame and decorations come from a CDN
// that sends no CORS header. SSRF-guarded in the service — see the controller.
router.get('/media/proxy', controller.proxyImage);

// Events. `/events/stats` and `/events/qr/decode` are declared BEFORE
// `/events/:id`, or Express matches "stats" and "qr" as an id and the handler
// spends its time looking for event number NaN.
router.get('/events/stats', eventController.stats);
router.get('/events/analytics', eventController.analytics);
router.post('/events/qr/decode', eventController.decodeQr);

router.get('/events', eventController.list);
router.post('/events', eventController.create);
router.get('/events/:id', eventController.getById);
router.put('/events/:id', eventController.update);
router.delete('/events/:id', eventController.remove);

/**
 * Guests.
 *
 * The literal paths come BEFORE `/guests/:id`, or Express matches "stats",
 * "groups", "import" and "export" as an id and the handler spends its time
 * looking for guest number NaN.
 */
router.get('/guests/stats', guestController.stats);
router.get('/guests/export', guestController.exportGuests);
router.post('/guests/bulk', guestController.bulk);

// Import. `preview` writes nothing; `import` is the only one that does.
router.get('/guests/import/sample', guestController.sampleCsv);
router.post('/guests/import/preview', guestController.previewImport);
router.post('/guests/import', guestController.commitImport);

// Groups, also before `/guests/:id` for the same reason.
router.get('/guests/groups/all', guestController.allGroups);
router.get('/guests/groups/stats', guestController.groupStats);
router.get('/guests/groups', guestController.listGroups);
router.post('/guests/groups', guestController.createGroup);
router.get('/guests/groups/:id', guestController.getGroup);
router.put('/guests/groups/:id', guestController.updateGroup);
router.delete('/guests/groups/:id', guestController.removeGroup);

router.get('/guests', guestController.list);
router.post('/guests', guestController.create);
router.get('/guests/:id', guestController.getById);
router.put('/guests/:id', guestController.update);
router.delete('/guests/:id', guestController.remove);

/**
 * Billing — Phase 1: Overview and Change Plan.
 *
 * No `:id` on any of these: each acts on the signed-in client's own
 * subscription, so none can be aimed at another account.
 *
 * There is deliberately no checkout, payment-method or invoice route. Those
 * screens exist in the design and have neither tables nor a payment provider
 * behind them; the overview payload reports each as unavailable with a reason
 * rather than the API pretending to serve them.
 */
router.get('/billing/overview', billingController.overview);
router.get('/billing/plans', billingController.plans);
router.get('/billing/history', billingController.history);
router.post('/billing/change-plan', billingController.changePlan);
router.post('/billing/cancel', billingController.cancel);
router.post('/billing/resume', billingController.resume);

// Invoices. The literal path comes BEFORE `/billing/invoices/:id`, the same
// trap as `/events/stats` and `/guests/groups` — otherwise Express matches the
// word as an id and the handler looks for invoice number NaN.
router.get('/billing/invoices', billingController.listInvoices);
router.get('/billing/invoices/:id', billingController.getInvoice);

// Contact Sales. Stored, not emailed — there is no SMTP in this system.
router.post('/billing/contact-sales', billingController.contactSales);

module.exports = router;
