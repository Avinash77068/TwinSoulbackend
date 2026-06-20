const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/capsule.controller');

router.get('/', protect, c.getCapsules);
router.post('/', protect, upload.single('media'), handleR2Upload, c.createCapsule);
router.post('/:id/unlock', protect, c.unlockCapsule);
router.delete('/:id', protect, c.deleteCapsule);

module.exports = router;
