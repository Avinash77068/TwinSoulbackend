const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/youtube.controller');

router.get('/search', protect, c.search);
router.get('/trending', protect, c.trending);

module.exports = router;
