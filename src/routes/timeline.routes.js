const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/timeline.controller');

router.get('/', protect, active, c.getTimeline);
router.post('/', protect, active, upload.single('media'), handleR2Upload, c.createEvent);
router.delete('/:id', protect, active, c.deleteEvent);

module.exports = router;
