const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/mood.controller');

router.post('/checkin', protect, c.checkin);
router.get('/today', protect, c.getTodayMood);
router.get('/history', protect, c.getMoodHistory);
router.get('/partner', protect, c.getPartnerMood);

module.exports = router;
