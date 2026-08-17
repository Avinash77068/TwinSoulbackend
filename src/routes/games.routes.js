const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/games.controller');

// Wheel activities (must be before /:id routes)
router.get('/wheel/activities', protect, active, c.getWheelActivities);
router.put('/wheel/activities', protect, active, c.saveWheelActivities);
router.delete('/wheel/activities', protect, active, c.resetWheelActivities);
router.post('/wheel/spin', protect, active, c.spinWheelActivity);

// Custom prompts per game type (must be before /:id routes)
router.get('/:gameType/prompts', protect, active, c.getGamePrompts);
router.put('/:gameType/prompts', protect, active, c.saveGamePrompts);
router.delete('/:gameType/prompts', protect, active, c.resetGamePrompts);

// Legacy spin endpoint
router.get('/spin', protect, active, c.spinWheel);

// Game sessions
router.get('/', protect, active, c.getGames);
router.post('/start', protect, active, c.startGame);
router.post('/:id/answer', protect, active, c.submitAnswer);
router.post('/:id/complete', protect, active, c.completeGame);
router.get('/:id/result', protect, active, c.getGameResult);

module.exports = router;
