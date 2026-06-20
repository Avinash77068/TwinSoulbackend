const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/timeline.controller');

router.get('/', protect, c.getTimeline);
router.post('/', protect, upload.single('media'), handleR2Upload, c.createEvent);
router.delete('/:id', protect, c.deleteEvent);

module.exports = router;
