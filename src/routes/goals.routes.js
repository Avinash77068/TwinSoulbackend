const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/goals.controller');

router.get('/', protect, active, c.getGoals);
router.post('/', protect, active, c.createGoal);
router.get('/:id', protect, active, c.getGoal);
router.put('/:id', protect, active, c.updateGoal);
router.delete('/:id', protect, active, c.deleteGoal);
router.put('/:id/progress', protect, active, c.setProgress);
router.post('/:id/milestones', protect, active, c.addMilestone);
router.put('/:id/milestones/:milestoneId', protect, active, c.toggleMilestone);

module.exports = router;
