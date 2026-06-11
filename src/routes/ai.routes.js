const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/ai.controller');

router.get('/suggestions', protect, c.getSuggestions);
router.get('/insights', protect, c.getInsights);
router.get('/reminders', protect, c.getReminders);
router.get('/mood-trends', protect, c.getMoodTrends);

module.exports = router;
