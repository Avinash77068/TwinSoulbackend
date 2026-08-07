const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/chat.controller');

router.get('/messages', protect, active, c.getMessages);
router.put('/messages/read', protect, active, c.markRead);
router.put('/messages/delivered', protect, active, c.markDelivered);
router.put('/messages/:id/pin', protect, active, c.pinMessage);
router.delete('/messages/clear', protect, active, c.clearMessages);
router.delete('/messages/:id', protect, active, c.deleteMessage);
router.put('/messages/:id', protect, active, c.editMessage);
router.get('/messages/secret', protect, active, c.getSecretMessages);
router.get('/messages/pinned', protect, active, c.getPinnedMessages);
router.post('/messages/:id/react', protect, active, c.reactToMessage);
router.delete('/messages/:id/react', protect, active, c.removeReaction);
router.put('/messages/:id/favorite', protect, active, c.favoriteMessage);
router.get('/messages/favorites', protect, active, c.getFavoriteMessages);
router.post('/messages', protect, active, upload.single('media'), handleR2Upload, c.sendMessage);
router.post('/messages/bulk', protect, active, c.bulkSyncMessages);
router.put('/bubble-color', protect, active, c.updateBubbleColor);

module.exports = router;
