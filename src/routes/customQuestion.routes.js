const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/customQuestion.controller');

router.get('/', protect, c.getCustomQuestions);
router.post('/', protect, upload.single('questionPhoto'), handleR2Upload, c.askQuestion);
router.post('/:id/answer', protect, upload.single('answerPhoto'), handleR2Upload, c.answerQuestion);

module.exports = router;
