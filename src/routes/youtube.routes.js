const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { requirePremium } = require('../middleware/premium');
const c = require('../controllers/youtube.controller');

const watchTogetherGate = requirePremium('Watch Together', 'watchTogetherRequiresPremium');

/**
 * Tighter than the global /api limiter: every call here costs one upstream
 * YouTube request, and the official Data API bills 100 quota units per search
 * — an unthrottled client could burn a whole day's quota in minutes.
 */
const youtubeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many searches. Please slow down.' },
});

router.get('/search', protect, watchTogetherGate, youtubeLimiter, c.search);
router.get('/trending', protect, watchTogetherGate, youtubeLimiter, c.trending);

module.exports = router;
