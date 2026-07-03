const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/chat.controller');

router.get('/messages', protect, c.getMessages);
router.put('/messages/read', protect, c.markRead);
router.put('/messages/:id/pin', protect, c.pinMessage);
router.delete('/messages/clear', protect, c.clearMessages);
router.delete('/messages/:id', protect, c.deleteMessage);
router.get('/messages/search', protect, c.searchMessages);
router.get('/messages/secret', protect, c.getSecretMessages);
router.get('/messages/pinned', protect, c.getPinnedMessages);
router.post('/messages/:id/react', protect, c.reactToMessage);
router.delete('/messages/:id/react', protect, c.removeReaction);
router.post('/messages/:id/forward', protect, c.forwardMessage);
router.put('/messages/:id/favorite', protect, c.favoriteMessage);
router.get('/messages/favorites', protect, c.getFavoriteMessages);
router.post('/messages', protect, upload.single('media'), handleR2Upload, c.sendMessage);

module.exports = router;
