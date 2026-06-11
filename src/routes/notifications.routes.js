const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/notifications.controller');

router.get('/', protect, c.getNotifications);
router.put('/read-all', protect, c.markAllRead);
router.delete('/clear-all', protect, c.clearAll);
router.put('/:id/read', protect, c.markRead);
router.delete('/:id', protect, c.deleteNotification);

module.exports = router;
