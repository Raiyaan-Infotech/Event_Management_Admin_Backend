const router = require('express').Router();
const { isChatAuthenticated } = require('../middleware/chatAuth');
const ctrl = require('../controllers/chat.controller');

router.use(isChatAuthenticated);

router.get('/contacts', ctrl.getContacts);
router.get('/conversations', ctrl.getConversations);
router.post('/conversations/direct', ctrl.getOrCreateDirectConversation);
router.get('/conversations/:id/messages', ctrl.getMessages);
router.patch('/conversations/:id/read', ctrl.markRead);
router.post('/messages', ctrl.sendMessage);

module.exports = router;
