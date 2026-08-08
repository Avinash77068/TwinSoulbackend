const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requirePremium } = require('../middleware/premium');
const c = require('../controllers/youtube.controller');

const watchTogetherGate = requirePremium('Watch Together', 'watchTogetherRequiresPremium');

router.get('/search', protect, watchTogetherGate, c.search);
router.get('/trending', protect, watchTogetherGate, c.trending);

module.exports = router;
