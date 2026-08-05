const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/ai.controller');

router.get('/suggestions', protect, active, c.getSuggestions);
router.get('/insights', protect, active, c.getInsights);
router.get('/reminders', protect, active, c.getReminders);
router.get('/mood-trends', protect, active, c.getMoodTrends);

module.exports = router;
