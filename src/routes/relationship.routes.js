const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/relationship.controller');

router.post('/connect', protect, c.connectWithCode);
router.post('/approve', protect, c.approveConnection);
router.post('/decline', protect, c.declineConnection);
router.get('/pending', protect, c.getPendingRequest);
router.get('/dashboard', protect, c.getDashboard);
router.get('/info', protect, c.getRelationshipInfo);
router.post('/leave', protect, c.requestLeave);
router.post('/cancel-leave', protect, c.cancelLeave);
router.post('/restore', protect, c.restoreRelationship);
router.patch('/features', protect, c.updateFeatures);

module.exports = router;
