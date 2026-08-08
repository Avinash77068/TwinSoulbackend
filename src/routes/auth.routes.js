const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/auth.controller');

router.post('/register', c.register);
router.post('/verify-otp', c.verifyOtp);
router.post('/complete-registration', c.completeRegistration);
router.post('/login', c.login);

// ── Forgot password ────────────────────────────────────────────────────────────
// Public by necessity — the user cannot authenticate. Brute-force protection is
// the strict rate limiter in server.js plus the per-account attempt counter and
// resend cooldown in the controller.
router.post('/forgot-password', c.forgotPassword);
router.post('/verify-reset-otp', c.verifyResetOtp);
router.post('/reset-password', c.resetPassword);
router.get('/profile', protect, c.getProfile);
router.put('/profile', protect, upload.single('profilePhoto'), handleR2Upload, c.updateProfile);
router.post('/regenerate-codes', protect, c.regenerateCodes);
router.post('/fcm-token', protect, c.saveFcmToken);
router.put('/preferences', protect, c.updatePreferences);
router.put('/change-password', protect, c.changePassword);
router.post('/logout', protect, c.logout);

module.exports = router;
