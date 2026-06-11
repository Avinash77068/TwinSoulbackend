const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/diary.controller');

router.get('/', protect, c.getEntries);
router.post('/', protect, c.createEntry);
router.get('/private', protect, c.getPrivateEntries);
router.get('/shared', protect, c.getSharedEntries);
router.get('/search', protect, c.searchEntries);
router.get('/calendar', protect, c.getCalendarView);
router.get('/:id', protect, c.getEntry);
router.put('/:id', protect, c.updateEntry);
router.delete('/:id', protect, c.deleteEntry);
router.put('/:id/favorite', protect, c.toggleFavorite);

module.exports = router;
