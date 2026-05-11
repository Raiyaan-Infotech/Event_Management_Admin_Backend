const router = require('express').Router();
const { isMailAuthenticated } = require('../middleware/mailAuth');
const ctrl = require('../controllers/mail.controller');
const notifCtrl = require('../controllers/mailNotification.controller');

router.use(isMailAuthenticated);

// contacts
router.get('/contacts', ctrl.getContacts);

// notifications (before /:id)
router.get('/notifications', notifCtrl.getNotifications);
router.patch('/notifications/read', notifCtrl.markAllRead);

// compose
router.post('/drafts', ctrl.saveDraft);
router.put('/drafts/:id', ctrl.updateDraft);
router.post('/drafts/:id/send', ctrl.sendDraft);
router.post('/send', ctrl.sendMail);

// views (before /:id)
router.get('/sent', ctrl.getSent);
router.get('/drafts', ctrl.getDrafts);
router.get('/trash', ctrl.getTrash);

// trash operations (before /:id)
router.patch('/trash/:id/restore', ctrl.restore);
router.delete('/trash/:id', ctrl.permanentDelete);

// bulk operations (before /:id)
router.post('/bulk-delete', ctrl.bulkRemove);
router.post('/bulk-read', ctrl.bulkMarkRead);
router.post('/bulk-label', ctrl.bulkAssignLabel);
router.post('/bulk-folder', ctrl.bulkMoveToFolder);

// folders (before /:id)
router.get('/folders', ctrl.getFolders);
router.post('/folders', ctrl.createFolder);
router.put('/folders/:id', ctrl.updateFolder);
router.patch('/folders/:id/status', ctrl.updateFolder);
router.delete('/folders/:id', ctrl.deleteFolder);

// inbox (last static, before /:id)
router.get('/', ctrl.getInbox);

// single mail (dynamic, must be last)
router.get('/:id', ctrl.getById);
router.delete('/:id', ctrl.remove);
router.patch('/:id/read', ctrl.toggleRead);
router.patch('/:id/label', ctrl.assignLabel);
router.patch('/:id/folder', ctrl.moveToFolder);

module.exports = router;
