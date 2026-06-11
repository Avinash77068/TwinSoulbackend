const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/lovetree.controller');

router.get('/', protect, c.getTree);
router.post('/water', protect, c.addPoints);

module.exports = router;
