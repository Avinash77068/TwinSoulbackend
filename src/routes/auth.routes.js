const router = require('express').Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const c = require('../controllers/auth.controller');

router.post('/register', c.register);
router.post('/login', c.login);
router.get('/profile', protect, c.getProfile);
router.put('/profile', protect, upload.single('profilePhoto'), c.updateProfile);
router.post('/regenerate-codes', protect, c.regenerateCodes);
router.post('/fcm-token', protect, c.saveFcmToken);

module.exports = router;
