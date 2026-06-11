const router = require('express').Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const c = require('../controllers/chat.controller');

router.get('/messages', protect, c.getMessages);
router.post('/messages', protect, upload.single('media'), c.sendMessage);
router.delete('/messages/:id', protect, c.deleteMessage);
router.post('/messages/:id/react', protect, c.reactToMessage);
router.delete('/messages/:id/react', protect, c.removeReaction);
router.put('/messages/:id/pin', protect, c.pinMessage);
router.put('/messages/:id/favorite', protect, c.favoriteMessage);
router.put('/messages/read', protect, c.markRead);
router.post('/messages/:id/forward', protect, c.forwardMessage);
router.get('/messages/search', protect, c.searchMessages);
router.get('/messages/favorites', protect, c.getFavoriteMessages);
router.get('/messages/pinned', protect, c.getPinnedMessages);
router.get('/messages/secret', protect, c.getSecretMessages);

module.exports = router;
