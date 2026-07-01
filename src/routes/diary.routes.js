const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { upload, handleMultiCloudUpload } = require('../middleware/upload');
const c = require('../controllers/diary.controller');

const photoUpload = [upload.array('photos', 5), handleMultiCloudUpload];

router.get('/', protect, c.getEntries);
router.post('/', protect, ...photoUpload, c.createEntry);
router.get('/private', protect, c.getPrivateEntries);
router.get('/shared', protect, c.getSharedEntries);
router.get('/search', protect, c.searchEntries);
router.get('/calendar', protect, c.getCalendarView);
router.get('/:id', protect, c.getEntry);
router.put('/:id', protect, ...photoUpload, c.updateEntry);
router.delete('/:id', protect, c.deleteEntry);
router.put('/:id/favorite', protect, c.toggleFavorite);

module.exports = router;
