const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const { upload, handleMultiCloudUpload } = require('../middleware/upload');
const c = require('../controllers/diary.controller');

const photoUpload = [upload.array('photos', 5), handleMultiCloudUpload];

router.get('/', protect, active, c.getEntries);
router.post('/', protect, active, ...photoUpload, c.createEntry);
router.get('/private', protect, active, c.getPrivateEntries);
router.get('/shared', protect, active, c.getSharedEntries);
router.get('/search', protect, active, c.searchEntries);
router.get('/calendar', protect, active, c.getCalendarView);
router.get('/:id', protect, active, c.getEntry);
router.put('/:id', protect, active, ...photoUpload, c.updateEntry);
router.delete('/:id', protect, active, c.deleteEntry);
router.put('/:id/favorite', protect, active, c.toggleFavorite);

module.exports = router;
