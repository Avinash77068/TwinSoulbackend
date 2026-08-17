const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/customQuestion.controller');

router.get('/', protect, active, c.getCustomQuestions);
router.post('/', protect, active, upload.single('questionPhoto'), handleR2Upload, c.askQuestion);
router.put('/:id', protect, active, upload.single('questionPhoto'), handleR2Upload, c.editQuestion);
router.post('/:id/answer', protect, active, upload.single('answerPhoto'), handleR2Upload, c.answerQuestion);

module.exports = router;
