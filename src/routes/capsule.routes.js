const router = require('express').Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const c = require('../controllers/capsule.controller');

router.get('/', protect, c.getCapsules);
router.post('/', protect, upload.single('media'), c.createCapsule);
router.post('/:id/unlock', protect, c.unlockCapsule);
router.delete('/:id', protect, c.deleteCapsule);

module.exports = router;
