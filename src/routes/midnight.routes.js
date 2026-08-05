const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/midnight.controller');

router.post('/', protect, active, c.createEntry);
router.get('/today', protect, active, c.getTodayEntry);
router.get('/history', protect, active, c.getHistory);
router.get('/date/:date', protect, active, c.getThisDateMemory);

module.exports = router;
