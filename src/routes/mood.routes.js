const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');
const { cache } = require('../cache/cacheMiddleware');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/mood.controller');

router.post('/checkin', protect, active, c.checkin);
router.get('/today', protect, active, cache('mood-today', 30), c.getTodayMood);
router.get('/history', protect, active, c.getMoodHistory);
router.get('/partner', protect, active, cache('partner-mood', 30), c.getPartnerMood);

module.exports = router;
