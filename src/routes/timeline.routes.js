const router = require('express').Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const c = require('../controllers/timeline.controller');

router.get('/', protect, c.getTimeline);
router.post('/', protect, upload.single('media'), c.createEvent);
router.delete('/:id', protect, c.deleteEvent);

module.exports = router;
