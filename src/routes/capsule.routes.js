const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/capsule.controller');

router.get('/', protect, active, c.getCapsules);
router.post('/', protect, active, upload.single('media'), handleR2Upload, c.createCapsule);
router.post('/:id/unlock', protect, active, c.unlockCapsule);
router.delete('/:id', protect, active, c.deleteCapsule);

module.exports = router;
