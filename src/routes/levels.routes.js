const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/levels.controller');

router.get('/', protect, c.getLevel);
router.post('/xp', protect, c.addXP);

module.exports = router;
