const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/relationship.controller');
const homeController = require('../controllers/home.controller');

// ── Connecting ───────────────────────────────────────────────────────────────
router.post('/connect', protect, c.connectWithCode);   // couple-code fallback
router.post('/approve', protect, c.approveConnection);
router.post('/decline', protect, c.declineConnection);
router.get('/pending', protect, c.getPendingRequest);
router.post('/reconnect-choice', protect, c.reconnectChoose);

// ── Reading ──────────────────────────────────────────────────────────────────
// Combines dashboard + levels + mood/today + mood/partner + premium/status
// into one response for the Home screen's initial load.
router.get('/home', protect, homeController.getHomeBootstrap);
router.get('/dashboard', protect, c.getDashboard);
router.get('/stats', protect, c.getStats);
router.get('/info', protect, c.getRelationshipInfo);
router.get('/end-reasons', protect, c.getEndReasons);

// ── Lifecycle ────────────────────────────────────────────────────────────────
router.post('/leave', protect, c.requestLeave);         // ends immediately, archived
router.post('/pause', protect, c.pauseRelationship);    // "Take a Break"
router.post('/resume', protect, c.resumeRelationship);
router.post('/restore', protect, c.restoreRelationship);

router.patch('/features', protect, c.updateFeatures);

module.exports = router;
