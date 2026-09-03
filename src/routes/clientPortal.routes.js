const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/clientPortal.controller');
const eventController = require('../controllers/clientEvent.controller');
const guestController = require('../controllers/clientGuest.controller');
const billingController = require('../controllers/clientBilling.controller');
const preferencesController = require('../controllers/clientPreferences.controller');
const messageController = require('../controllers/clientMessage.controller');
const rsvpController = require('../controllers/clientRsvp.controller');
const guestProfileController = require('../controllers/clientGuestProfile.controller');
const securityController = require('../controllers/clientSecurity.controller');
const splashController = require('../controllers/clientSplashScreen.controller');
const { isWebsiteClientAuthenticated } = require('../middleware/websiteClientAuth');
const { codeLimiter } = require('../middleware/rateLimit');

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
 * Settings — preferences and notification choices.
 *
 * `/settings` returns everything the two screens need in ONE response:
 * the client's stored values, the notification CATALOGUE, the allowed options
 * for every dropdown, which preferences are actually applied yet, and whether
 * either channel can deliver anything. The catalogue is served rather than
 * hardcoded in the UI so the list the screen renders and the list the server
 * validates against cannot drift apart.
 *
 * Both writes answer with that same full shape, so the screen replaces its
 * state instead of merging into it.
 */
router.get('/settings', preferencesController.getSettings);
router.put('/settings/preferences', preferencesController.updatePreferences);
router.put('/settings/notifications', preferencesController.updateNotifications);

/**
 * Security — Active Sessions, Authorized Devices and two-factor authentication.
 *
 * ⚠ Sessions and devices are ONE table read two ways, not two tables. See the
 * ClientSession model header: two would be two copies of "which device is this",
 * and the first symptom of them drifting is a device you revoked still being
 * able to sign in.
 *
 * None of these takes a client id — each acts on the session's own client — and
 * a session id is matched against the caller's own rows before anything happens
 * to it, so one client cannot revoke another's session by guessing a number.
 *
 * The 2FA routes are rate limited: they check a six-digit code, which is only a
 * second factor if guessing it is slow.
 */
router.get('/security/sessions', securityController.listSessions);
router.delete('/security/sessions/:id', securityController.revokeSession);
router.post('/security/sessions/revoke-all', securityController.revokeOtherSessions);

router.get('/security/devices', securityController.listDevices);
router.delete('/security/devices/:id', securityController.removeDevice);

router.get('/security/2fa', securityController.getTwoFactor);
router.post('/security/2fa/setup', codeLimiter, securityController.setupTwoFactor);
router.post('/security/2fa/confirm', codeLimiter, securityController.confirmTwoFactor);
router.post('/security/2fa/disable', codeLimiter, securityController.disableTwoFactor);
router.post('/security/2fa/backup-codes', codeLimiter, securityController.regenerateBackupCodes);

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
 * Messages.
 *
 * ⚠ Nothing here delivers anything yet. No WhatsApp, SMS or SMTP provider is
 * configured, so `send` records the campaign and its per-recipient rows and
 * says so in its own response — the same shape the vendor newsletter uses.
 * Every payload carries `channels[]` with the real state and the reason, so the
 * screens describe it rather than each hardcoding an assumption.
 *
 * `composer`, `preview` and `test` come BEFORE `/messages/:id`, or Express
 * matches them as an id and the handler looks for campaign number NaN.
 */
router.get('/messages/composer', messageController.composer);
// Writes nothing — it resolves the audience so the review step and the send
// cannot disagree about who is reachable.
router.post('/messages/preview', messageController.preview);
router.post('/messages/test', messageController.sendTest);
router.post('/messages/send', messageController.send);
router.get('/messages', messageController.list);
router.get('/messages/:id', messageController.getById);

/**
 * RSVPs.
 *
 * ⚠ An RSVP is NOT a row — it is the response columns on a guest. So there is
 * no DELETE here. `PUT /:id/reset` CLEARS the response and leaves the guest on
 * the list; deleting the PERSON is `DELETE /guests/:id`, which already exists.
 * Two verbs for two different acts, so a destructive button cannot be wired to
 * the wrong one by reading the route name.
 *
 * `stats`, `export` and `groups` precede `/:id`, or Express matches them as an
 * id and the handler looks for RSVP number NaN.
 */
router.get('/rsvps/stats', rsvpController.stats);
router.get('/rsvps/export', rsvpController.exportRows);
router.get('/rsvps/groups/:id', rsvpController.getGroup);
router.get('/rsvps', rsvpController.list);
router.get('/rsvps/:id', rsvpController.getById);
router.put('/rsvps/:id', rsvpController.update);
// Named `reset`, not `delete`. See above.
router.put('/rsvps/:id/reset', rsvpController.resetResponse);
router.put('/rsvps/:id/group', rsvpController.moveToGroup);

/**
 * Guest Profile — the PERSON across every event.
 *
 * ⚠ A different question from `/rsvps/:id`, which is one guest's answer about
 * ONE event. The profile stitches every guest row sharing an email; the
 * payload's `identity` block says so, because that stitch can be wrong in two
 * directions and only the reader can tell.
 *
 * `:id` is a guest id — the same id `/rsvps/:id` takes, because an RSVP IS a
 * guest. One row, two lenses.
 *
 * ⚠ Every nested route repeats `:id`. Ownership is then checked on BOTH the
 * guest and the child, so a valid note id cannot be reached through a guest it
 * does not belong to.
 *
 * There is deliberately no route that writes name / email / phone here. Those
 * belong to `/guests/:id` — the same rule the RSVP edit screen follows.
 */
router.get('/guests/:id/profile', guestProfileController.get);
router.put('/guests/:id/profile', guestProfileController.update);

router.post('/guests/:id/notes', guestProfileController.createNote);
router.put('/guests/:id/notes/:noteId', guestProfileController.updateNote);
router.delete('/guests/:id/notes/:noteId', guestProfileController.deleteNote);

router.post('/guests/:id/tags', guestProfileController.addTag);
router.delete('/guests/:id/tags/:tagId', guestProfileController.removeTag);

router.post('/guests/:id/reminders', guestProfileController.createReminder);
router.put('/guests/:id/reminders/:reminderId', guestProfileController.updateReminder);
router.delete('/guests/:id/reminders/:reminderId', guestProfileController.deleteReminder);

/**
 * Notifications.
 *
 * Reads and flags only. There is deliberately NO create route: the feed is
 * written by other services through `notify()`, and a client who could post to
 * their own feed could forge "Payment Successful".
 *
 * `/count` and `/read-all` precede `/:id` for the same reason as above.
 */
router.get('/notifications/count', messageController.notificationCount);
router.put('/notifications/read-all', messageController.markAllRead);
router.get('/notifications', messageController.listNotifications);
router.put('/notifications/:id/read', messageController.markRead);
router.put('/notifications/:id/archive', messageController.archive);

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
/**
 * Payment methods.
 *
 * ⚠ POST takes the PROVIDER'S TOKEN, never card details. The card is taken by
 * the gateway's own hosted field in the browser and never reaches this server;
 * `clientPaymentMethod.service` refuses a card-shaped body so that stays true.
 *
 * The literal path comes BEFORE `/:id`, the same ordering §325 already caught
 * once on the invoice routes.
 */
router.get('/billing/payment-methods', billingController.listPaymentMethods);
router.post('/billing/payment-methods', billingController.addPaymentMethod);
router.put('/billing/payment-methods/:id/default', billingController.setDefaultPaymentMethod);
router.delete('/billing/payment-methods/:id', billingController.removePaymentMethod);

router.get('/billing/invoices', billingController.listInvoices);
router.get('/billing/invoices/:id', billingController.getInvoice);

// Contact Sales. Stored, not emailed — there is no SMTP in this system.
router.post('/billing/contact-sales', billingController.contactSales);

/**
 * Splash Screens — a standalone module, NOT yet tied to an event. See the
 * model/service headers for why `event_name` is plain text rather than a
 * foreign key, and why this is the mobile app's own splash screen, not a web
 * page.
 *
 * ⚠ The literal `/splash-screens/media` path comes BEFORE `/splash-screens/:id`
 * — the same ordering trap `/billing/invoices/:id` already caught once:
 * Express would otherwise match "media" as an id.
 */
const splashMediaUpload = multer({
    storage: multer.memoryStorage(),
    // 20MB covers the mock's own stated video/image limit; audio in practice
    // never approaches it, so one generous ceiling is simpler than three.
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
            'video/mp4', 'video/webm',
            'audio/mpeg', 'audio/wav', 'audio/ogg',
        ];
        if (allowed.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Please choose an image, video (MP4/WebM) or audio (MP3/WAV/OGG) file.'), false);
    },
});

router.post(
    '/splash-screens/media',
    (req, res, next) => {
        // Multer's own errors surfaced as a readable 400 — "File too large" is
        // something the person can act on, a 500 is not.
        splashMediaUpload.single('file')(req, res, (err) => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.code === 'LIMIT_FILE_SIZE'
                        ? 'That file is larger than 20MB.'
                        : err.message || 'That file could not be uploaded.',
                });
            }
            next();
        });
    },
    splashController.uploadMedia,
);

router.get('/splash-screens', splashController.list);
router.post('/splash-screens', splashController.create);
router.get('/splash-screens/:id', splashController.getOne);
router.put('/splash-screens/:id', splashController.update);
router.delete('/splash-screens/:id', splashController.remove);

module.exports = router;
