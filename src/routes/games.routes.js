const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/games.controller');

router.get('/', protect, c.getGames);
router.post('/start', protect, c.startGame);
router.get('/spin', protect, c.spinWheel);
router.post('/:id/answer', protect, c.submitAnswer);
router.get('/:id/result', protect, c.getGameResult);

module.exports = router;
