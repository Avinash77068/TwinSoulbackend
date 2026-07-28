const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/goals.controller');

router.get('/', protect, c.getGoals);
router.post('/', protect, c.createGoal);
router.get('/:id', protect, c.getGoal);
router.put('/:id', protect, c.updateGoal);
router.delete('/:id', protect, c.deleteGoal);
router.put('/:id/progress', protect, c.setProgress);
router.post('/:id/milestones', protect, c.addMilestone);
router.put('/:id/milestones/:milestoneId', protect, c.toggleMilestone);

module.exports = router;
