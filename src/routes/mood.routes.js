const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/mood.controller');

router.post('/checkin', protect, active, c.checkin);
router.get('/today', protect, active, c.getTodayMood);
router.get('/history', protect, active, c.getMoodHistory);
router.get('/partner', protect, active, c.getPartnerMood);

module.exports = router;
