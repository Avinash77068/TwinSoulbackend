const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/presence.controller');

router.post('/heartbeat', protect, c.heartbeat);
router.get('/status', protect, c.getStatus);
router.post('/offline', protect, c.setOffline);
router.post('/touch', protect, c.touchPresence);
router.post('/heartbeat-sync', protect, c.heartbeatSync);

module.exports = router;
