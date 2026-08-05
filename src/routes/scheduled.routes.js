const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/scheduled.controller');

router.get('/', protect, active, c.getScheduled);
router.post('/', protect, active, upload.single('media'), handleR2Upload, c.createScheduled);
router.get('/upcoming', protect, active, c.getUpcoming);
router.put('/:id', protect, active, c.updateScheduled);
router.delete('/:id', protect, active, c.cancelScheduled);

module.exports = router;
