const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/midnight.controller');

router.post('/', protect, c.createEntry);
router.get('/today', protect, c.getTodayEntry);
router.get('/history', protect, c.getHistory);
router.get('/date/:date', protect, c.getThisDateMemory);

module.exports = router;
