const router = require('express').Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const c = require('../controllers/scheduled.controller');

router.get('/', protect, c.getScheduled);
router.post('/', protect, upload.single('media'), c.createScheduled);
router.get('/upcoming', protect, c.getUpcoming);
router.put('/:id', protect, c.updateScheduled);
router.delete('/:id', protect, c.cancelScheduled);

module.exports = router;
