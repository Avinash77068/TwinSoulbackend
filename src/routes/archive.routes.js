const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/archive.controller');

// All archive access is authorised by MEMBERSHIP in the relationship, not by the
// caller's current relationshipId — otherwise archived content is unreachable.
router.get('/', protect, c.listChapters);
router.get('/:relationshipId', protect, c.getChapter);
router.get('/:relationshipId/messages', protect, c.getMessages);
router.get('/:relationshipId/photos', protect, c.getPhotos);
router.get('/:relationshipId/diary', protect, c.getDiary);
router.get('/:relationshipId/timeline', protect, c.getTimeline);
router.get('/:relationshipId/export', protect, c.exportChapter);

router.patch('/:relationshipId/hide', protect, c.setHidden);
router.post('/:relationshipId/purge', protect, c.schedulePurge);
router.delete('/:relationshipId/purge', protect, c.cancelPurge);

module.exports = router;
