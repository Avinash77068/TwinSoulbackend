const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/games.controller');

// Wheel activities (must be before /:id routes)
router.get('/wheel/activities', protect, c.getWheelActivities);
router.put('/wheel/activities', protect, c.saveWheelActivities);
router.delete('/wheel/activities', protect, c.resetWheelActivities);
router.post('/wheel/spin', protect, c.spinWheelActivity);

// Legacy spin endpoint
router.get('/spin', protect, c.spinWheel);

// Game sessions
router.get('/', protect, c.getGames);
router.post('/start', protect, c.startGame);
router.post('/:id/answer', protect, c.submitAnswer);
router.get('/:id/result', protect, c.getGameResult);

module.exports = router;
