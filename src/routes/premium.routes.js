const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/premium.controller');

router.get('/status', protect, c.getStatus);

// Dev-only. Both return 404 unless ALLOW_DEV_PREMIUM=true, so leaving them
// mounted in production is inert rather than a free upgrade endpoint.
router.post('/dev-activate', protect, c.devActivate);
router.post('/dev-deactivate', protect, c.devDeactivate);

module.exports = router;
