const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/feedback.controller');

router.post('/', protect, c.submitFeedback);

module.exports = router;
