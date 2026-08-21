const express = require('express');
const router = express.Router();
const controller = require('../controllers/clientPortal.controller');
const eventController = require('../controllers/clientEvent.controller');
const guestController = require('../controllers/clientGuest.controller');
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
router.get('/event-options', controller.eventOptions);
router.put('/favourite-templates', controller.setFavouriteTemplates);

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

module.exports = router;
